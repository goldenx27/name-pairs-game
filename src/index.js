const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const GLOBAL_FAMILY_ID = 'catalog_global';

async function hashPin(pin) {
  const data = new TextEncoder().encode(String(pin));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyParentPin(env, familyId, pin) {
  if (!familyId || !pin) return false;
  const row = await env.DB.prepare(`SELECT parent_pin_hash FROM families WHERE id=?`).bind(familyId).first();
  if (!row?.parent_pin_hash) return false;
  return row.parent_pin_hash === await hashPin(pin);
}

async function ensureState(env, playerId) {
  await env.DB.prepare(`INSERT OR IGNORE INTO player_state (player_id,current_pool_size) VALUES (?,2)`).bind(playerId).run();
  const chars = await env.DB.prepare(`
    SELECT c.id FROM characters c
    WHERE c.enabled=1 AND (c.family_id=? OR c.family_id=(SELECT family_id FROM players WHERE id=?))
    ORDER BY c.priority DESC, c.created_at ASC
  `).bind(GLOBAL_FAMILY_ID, playerId).all();

  for (const c of chars.results) {
    await env.DB.prepare(`INSERT OR IGNORE INTO player_character_state (player_id, character_id) VALUES (?, ?)`)
      .bind(playerId, c.id).run();
  }

  const state = await env.DB.prepare(`SELECT * FROM player_state WHERE player_id=?`).bind(playerId).first();
  const introduced = await env.DB.prepare(`SELECT COUNT(*) AS n FROM player_character_state WHERE player_id=? AND status!='hidden'`).bind(playerId).first();
  const targetPool = Math.min(Number(state?.current_pool_size || 2), chars.results.length);
  const need = Math.max(0, targetPool - Number(introduced?.n || 0));
  if (need > 0) {
    const hidden = await env.DB.prepare(`
      SELECT pcs.character_id FROM player_character_state pcs
      JOIN characters c ON c.id=pcs.character_id
      WHERE pcs.player_id=? AND pcs.status='hidden' AND c.enabled=1
      ORDER BY c.priority DESC, c.created_at ASC LIMIT ?
    `).bind(playerId, need).all();
    for (const row of hidden.results) {
      await env.DB.prepare(`UPDATE player_character_state SET status='introduced',updated_at=? WHERE player_id=? AND character_id=?`)
        .bind(now(), playerId, row.character_id).run();
    }
  }
}

async function maybeUnlock(env, playerId) {
  await ensureState(env, playerId);
  const state = await env.DB.prepare(`SELECT * FROM player_state WHERE player_id=?`).bind(playerId).first();
  if (Number(state?.rounds_since_unlock || 0) < 3) return null;

  const next = await env.DB.prepare(`
    SELECT pcs.character_id,c.name FROM player_character_state pcs
    JOIN characters c ON c.id=pcs.character_id
    WHERE pcs.player_id=? AND pcs.status='hidden' AND c.enabled=1
    ORDER BY c.priority DESC,c.created_at ASC LIMIT 1
  `).bind(playerId).first();
  if (!next) return null;

  await env.DB.batch([
    env.DB.prepare(`UPDATE player_character_state SET status='introduced',updated_at=? WHERE player_id=? AND character_id=?`).bind(now(),playerId,next.character_id),
    env.DB.prepare(`UPDATE player_state SET current_pool_size=current_pool_size+1,rounds_since_unlock=0,updated_at=? WHERE player_id=?`).bind(now(),playerId)
  ]);
  return next;
}

async function playerSnapshot(env, playerId) {
  await ensureState(env, playerId);
  const player = await env.DB.prepare(`SELECT p.*,f.parent_pin_hash FROM players p JOIN families f ON f.id=p.family_id WHERE p.id=?`).bind(playerId).first();
  if (!player) return null;
  const chars = await env.DB.prepare(`
    SELECT c.id,c.name,c.priority,pcs.status,pcs.times_shown,pcs.correct_count,pcs.wrong_count,pcs.score,c.created_at
    FROM player_character_state pcs JOIN characters c ON c.id=pcs.character_id
    WHERE pcs.player_id=? AND c.enabled=1
    ORDER BY c.priority DESC,c.created_at ASC
  `).bind(playerId).all();
  const state = await env.DB.prepare(`SELECT * FROM player_state WHERE player_id=?`).bind(playerId).first();
  return {
    player: { id: player.id, family_id: player.family_id },
    hasParentPin: !!player.parent_pin_hash,
    state,
    characters: chars.results.map(c => ({...c,image1:`/media/${c.id}/1`,image2:`/media/${c.id}/2`,audio:`/media/${c.id}/audio`}))
  };
}

function chooseGameType(lastType, activeCount) {
  const types = activeCount >= 2 ? ['find_character','who_is_it','pairs'] : ['find_character'];
  const available = types.filter(t => t !== lastType);
  return available[Math.floor(Math.random() * available.length)] || types[0];
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/health') return json({ok:true,service:'name-pairs-game',version:'0.2'});

  if (request.method === 'POST' && path === '/api/bootstrap') {
    const body = await request.json().catch(() => ({}));
    const pin = String(body.pin || '').trim();
    if (!/^\d{4,6}$/.test(pin)) return json({error:'pin_must_be_4_to_6_digits'},400);
    const familyId=id('fam'), playerId=id('player');
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO families(id,name) VALUES(?,?)`).bind(GLOBAL_FAMILY_ID,'Global Character Catalog'),
      env.DB.prepare(`INSERT INTO families(id,name,parent_pin_hash) VALUES(?,?,?)`).bind(familyId,'Private Player',await hashPin(pin)),
      env.DB.prepare(`INSERT INTO players(id,family_id,name) VALUES(?,?,?)`).bind(playerId,familyId,'Player'),
      env.DB.prepare(`INSERT INTO player_state(player_id,current_pool_size) VALUES(?,2)`).bind(playerId)
    ]);
    await ensureState(env,playerId);
    return json({familyId,playerId},201);
  }

  if (request.method === 'POST' && path === '/api/parent/pin') {
    const b=await request.json();
    const pin=String(b.pin||'').trim();
    if (!/^\d{4,6}$/.test(pin)) return json({error:'pin_must_be_4_to_6_digits'},400);
    const family=await env.DB.prepare(`SELECT parent_pin_hash FROM families WHERE id=?`).bind(b.familyId).first();
    if (!family) return json({error:'family_not_found'},404);
    if (family.parent_pin_hash) return json({error:'pin_already_set'},409);
    await env.DB.prepare(`UPDATE families SET parent_pin_hash=? WHERE id=?`).bind(await hashPin(pin),b.familyId).run();
    return json({ok:true});
  }

  if (request.method === 'POST' && path === '/api/parent/verify') {
    const b=await request.json();
    return (await verifyParentPin(env,b.familyId,b.pin)) ? json({ok:true}) : json({error:'wrong_pin'},403);
  }

  const playerMatch=path.match(/^\/api\/players\/([^/]+)\/state$/);
  if (request.method==='GET' && playerMatch) {
    const snap=await playerSnapshot(env,playerMatch[1]);
    return snap?json(snap):json({error:'player_not_found'},404);
  }

  const resetMatch=path.match(/^\/api\/players\/([^/]+)\/reset$/);
  if (request.method==='POST' && resetMatch) {
    const b=await request.json();
    if (!(await verifyParentPin(env,b.familyId,b.parentPin))) return json({error:'wrong_pin'},403);
    const playerId=resetMatch[1];
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM confusions WHERE player_id=?`).bind(playerId),
      env.DB.prepare(`DELETE FROM game_events WHERE player_id=?`).bind(playerId),
      env.DB.prepare(`DELETE FROM game_sessions WHERE player_id=?`).bind(playerId),
      env.DB.prepare(`DELETE FROM player_character_state WHERE player_id=?`).bind(playerId),
      env.DB.prepare(`UPDATE player_state SET games_played=0,current_pool_size=2,rounds_since_unlock=0,last_character_id=NULL,last_game_type=NULL,last_session_at=NULL,updated_at=? WHERE player_id=?`).bind(now(),playerId)
    ]);
    await ensureState(env,playerId);
    return json({ok:true});
  }

  if (request.method==='GET' && path==='/api/characters') {
    const rows=await env.DB.prepare(`SELECT id,name,enabled,priority,created_at FROM characters WHERE family_id=? ORDER BY priority DESC,created_at ASC`).bind(GLOBAL_FAMILY_ID).all();
    return json(rows.results.map(c=>({...c,image1:`/media/${c.id}/1`,image2:`/media/${c.id}/2`,audio:`/media/${c.id}/audio`})));
  }

  if (request.method==='POST' && path==='/api/characters') {
    const form=await request.formData();
    const familyId=String(form.get('familyId')||'');
    const parentPin=String(form.get('parentPin')||'');
    if (!(await verifyParentPin(env,familyId,parentPin))) return json({error:'wrong_pin'},403);
    const name=String(form.get('name')||'').trim();
    const image1=form.get('image1'),image2=form.get('image2'),audio=form.get('audio');
    if (!name || !(image1 instanceof File) || !(image2 instanceof File) || !(audio instanceof File)) return json({error:'name_two_images_and_audio_required'},400);
    const characterId=id('char'),base=`${GLOBAL_FAMILY_ID}/${characterId}`;
    const k1=`${base}/image1`,k2=`${base}/image2`,ka=`${base}/audio`;
    await Promise.all([
      env.MEDIA.put(k1,image1.stream(),{httpMetadata:{contentType:image1.type||'image/jpeg'}}),
      env.MEDIA.put(k2,image2.stream(),{httpMetadata:{contentType:image2.type||'image/jpeg'}}),
      env.MEDIA.put(ka,audio.stream(),{httpMetadata:{contentType:audio.type||'audio/webm'}})
    ]);
    await env.DB.prepare(`INSERT INTO characters(id,family_id,name,image_1_key,image_2_key,audio_key) VALUES(?,?,?,?,?,?)`).bind(characterId,GLOBAL_FAMILY_ID,name,k1,k2,ka).run();
    const players=await env.DB.prepare(`SELECT id FROM players`).all();
    for (const p of players.results) await env.DB.prepare(`INSERT OR IGNORE INTO player_character_state(player_id,character_id) VALUES(?,?)`).bind(p.id,characterId).run();
    return json({id:characterId,name},201);
  }

  const charMatch=path.match(/^\/api\/characters\/([^/]+)$/);
  if (charMatch && request.method==='PATCH') {
    const form=await request.formData();
    const familyId=String(form.get('familyId')||''),parentPin=String(form.get('parentPin')||'');
    if (!(await verifyParentPin(env,familyId,parentPin))) return json({error:'wrong_pin'},403);
    const characterId=charMatch[1];
    const row=await env.DB.prepare(`SELECT * FROM characters WHERE id=? AND family_id=?`).bind(characterId,GLOBAL_FAMILY_ID).first();
    if (!row) return json({error:'character_not_found'},404);
    const name=String(form.get('name')||row.name).trim();
    for (const [field,key] of [['image1',row.image_1_key],['image2',row.image_2_key],['audio',row.audio_key]]) {
      const file=form.get(field);
      if (file instanceof File && file.size>0) {
        await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type||(field==='audio'?'audio/webm':'image/jpeg')}});
      }
    }
    await env.DB.prepare(`UPDATE characters SET name=?,updated_at=? WHERE id=?`).bind(name,now(),characterId).run();
    return json({ok:true,id:characterId,name});
  }

  if (charMatch && request.method==='DELETE') {
    const b=await request.json();
    if (!(await verifyParentPin(env,b.familyId,b.parentPin))) return json({error:'wrong_pin'},403);
    const row=await env.DB.prepare(`SELECT * FROM characters WHERE id=? AND family_id=?`).bind(charMatch[1],GLOBAL_FAMILY_ID).first();
    if (!row) return json({error:'character_not_found'},404);
    await Promise.all([env.MEDIA.delete(row.image_1_key),env.MEDIA.delete(row.image_2_key),env.MEDIA.delete(row.audio_key)]);
    await env.DB.prepare(`DELETE FROM characters WHERE id=?`).bind(row.id).run();
    return json({ok:true});
  }

  if (request.method==='POST' && path==='/api/session/start') {
    const b=await request.json(),sessionId=id('session');
    await env.DB.prepare(`INSERT INTO game_sessions(id,player_id,game_type) VALUES(?,?,?)`).bind(sessionId,b.playerId,b.gameType||'mixed').run();
    return json({sessionId},201);
  }

  if (request.method==='POST' && path==='/api/events') {
    const b=await request.json();
    if (!b.playerId||!b.eventType) return json({error:'playerId_and_eventType_required'},400);
    await env.DB.prepare(`INSERT INTO game_events(session_id,player_id,event_type,character_id,selected_character_id,image_slot,result) VALUES(?,?,?,?,?,?,?)`).bind(b.sessionId||null,b.playerId,b.eventType,b.characterId||null,b.selectedCharacterId||null,b.imageSlot||null,b.result||null).run();
    if (b.characterId && ['correct','wrong'].includes(b.result)) {
      const correct=b.result==='correct',slot=Number(b.imageSlot)===2?2:1;
      await env.DB.prepare(`
        UPDATE player_character_state SET
          status=CASE WHEN status='introduced' THEN 'active' ELSE status END,
          times_shown=times_shown+1,
          correct_count=correct_count+?,wrong_count=wrong_count+?,
          image1_correct=image1_correct+?,image1_wrong=image1_wrong+?,
          image2_correct=image2_correct+?,image2_wrong=image2_wrong+?,
          score=CAST(correct_count+? AS REAL)/MAX(1,correct_count+wrong_count+1),
          last_seen=?,last_correct=CASE WHEN ?=1 THEN ? ELSE last_correct END,updated_at=?
        WHERE player_id=? AND character_id=?
      `).bind(correct?1:0,correct?0:1,correct&&slot===1?1:0,!correct&&slot===1?1:0,correct&&slot===2?1:0,!correct&&slot===2?1:0,correct?1:0,now(),correct?1:0,now(),now(),b.playerId,b.characterId).run();
      if (correct) await env.DB.prepare(`UPDATE player_state SET rounds_since_unlock=rounds_since_unlock+1,last_character_id=?,updated_at=? WHERE player_id=?`).bind(b.characterId,now(),b.playerId).run();
      if (!correct && b.selectedCharacterId && b.selectedCharacterId!==b.characterId) {
        await env.DB.prepare(`INSERT INTO confusions(player_id,expected_character_id,selected_character_id,count,last_occurrence) VALUES(?,?,?,?,?) ON CONFLICT(player_id,expected_character_id,selected_character_id) DO UPDATE SET count=count+1,last_occurrence=excluded.last_occurrence`).bind(b.playerId,b.characterId,b.selectedCharacterId,1,now()).run();
      }
    }
    const unlocked=await maybeUnlock(env,b.playerId);
    return json({ok:true,unlocked});
  }

  if (request.method==='GET' && path==='/api/game/next') {
    const playerId=url.searchParams.get('playerId');
    if (!playerId) return json({error:'playerId_required'},400);
    const snap=await playerSnapshot(env,playerId);
    if (!snap) return json({error:'player_not_found'},404);
    const active=snap.characters.filter(c=>c.status!=='hidden');
    if (active.length<2) return json({type:'waiting_for_characters',characters:active});
    const lastType=snap.state?.last_game_type;
    const gameType=chooseGameType(lastType,active.length);
    await env.DB.prepare(`UPDATE player_state SET last_game_type=?,updated_at=? WHERE player_id=?`).bind(gameType,now(),playerId).run();

    const sorted=[...active].sort((a,b)=>(a.score-b.score)||(a.times_shown-b.times_shown));
    let target=sorted[0];
    if (target.id===snap.state?.last_character_id && sorted[1]) target=sorted[1];
    const others=active.filter(c=>c.id!==target.id).sort(()=>Math.random()-.5).slice(0,3);
    const imageSlot=Math.random()<.5?1:2;

    if (gameType==='find_character') return json({type:gameType,target,imageSlot,options:[target,...others].sort(()=>Math.random()-.5)});
    if (gameType==='who_is_it') return json({type:gameType,target,imageSlot,options:[target,...others].sort(()=>Math.random()-.5)});

    const pairChars=[...active].sort(()=>Math.random()-.5).slice(0,Math.min(3,active.length));
    const cards=pairChars.flatMap(c=>[
      {cardId:`${c.id}_1`,characterId:c.id,image:c.image1,audio:c.audio,name:c.name,imageSlot:1},
      {cardId:`${c.id}_2`,characterId:c.id,image:c.image2,audio:c.audio,name:c.name,imageSlot:2}
    ]).sort(()=>Math.random()-.5);
    return json({type:'pairs',cards});
  }

  return json({error:'not_found'},404);
}

async function serveMedia(request,env,url) {
  const m=url.pathname.match(/^\/media\/([^/]+)\/(1|2|audio)$/);
  if (!m) return new Response('Not found',{status:404});
  const row=await env.DB.prepare(`SELECT image_1_key,image_2_key,audio_key FROM characters WHERE id=? AND enabled=1`).bind(m[1]).first();
  if (!row) return new Response('Not found',{status:404});
  const key=m[2]==='1'?row.image_1_key:m[2]==='2'?row.image_2_key:row.audio_key;
  const obj=await env.MEDIA.get(key);
  if (!obj) return new Response('Not found',{status:404});
  const headers=new Headers();obj.writeHttpMetadata(headers);headers.set('etag',obj.httpEtag);headers.set('cache-control','private, max-age=3600');
  return new Response(obj.body,{headers});
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request,env,url);
      if (url.pathname.startsWith('/media/')) return await serveMedia(request,env,url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({error:'internal_error',detail:String(e?.message||e)},500);
    }
  }
};
