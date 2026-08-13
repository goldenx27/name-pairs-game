const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

async function ensureState(env, playerId) {
  await env.DB.prepare(`INSERT OR IGNORE INTO player_state (player_id) VALUES (?)`).bind(playerId).run();
  const chars = await env.DB.prepare(`
    SELECT c.id FROM characters c
    LEFT JOIN player_character_state pcs ON pcs.character_id = c.id AND pcs.player_id = ?
    WHERE c.enabled = 1 AND c.family_id = (SELECT family_id FROM players WHERE id = ?)
    ORDER BY c.priority DESC, c.created_at ASC
  `).bind(playerId, playerId).all();

  for (const c of chars.results) {
    await env.DB.prepare(`INSERT OR IGNORE INTO player_character_state (player_id, character_id) VALUES (?, ?)`)
      .bind(playerId, c.id).run();
  }

  const state = await env.DB.prepare(`SELECT * FROM player_state WHERE player_id = ?`).bind(playerId).first();
  const introduced = await env.DB.prepare(`SELECT COUNT(*) AS n FROM player_character_state WHERE player_id = ? AND status != 'hidden'`).bind(playerId).first();
  const need = Math.max(0, Math.min(state.current_pool_size, chars.results.length) - Number(introduced?.n || 0));
  if (need > 0) {
    const hidden = await env.DB.prepare(`
      SELECT pcs.character_id FROM player_character_state pcs
      JOIN characters c ON c.id = pcs.character_id
      WHERE pcs.player_id = ? AND pcs.status = 'hidden' AND c.enabled = 1
      ORDER BY c.priority DESC, c.created_at ASC LIMIT ?
    `).bind(playerId, need).all();
    for (const row of hidden.results) {
      await env.DB.prepare(`UPDATE player_character_state SET status='introduced', updated_at=? WHERE player_id=? AND character_id=?`)
        .bind(now(), playerId, row.character_id).run();
    }
  }
}

async function maybeUnlock(env, playerId) {
  await ensureState(env, playerId);
  const active = await env.DB.prepare(`
    SELECT pcs.*, c.priority FROM player_character_state pcs
    JOIN characters c ON c.id = pcs.character_id
    WHERE pcs.player_id=? AND pcs.status!='hidden' AND c.enabled=1
  `).bind(playerId).all();
  if (!active.results.length) return null;

  const sufficientlyStable = active.results.every(x => {
    const attempts = x.correct_count + x.wrong_count;
    return attempts >= 4 && (x.correct_count / attempts) >= 0.72;
  });
  if (!sufficientlyStable) return null;

  const next = await env.DB.prepare(`
    SELECT pcs.character_id, c.name FROM player_character_state pcs
    JOIN characters c ON c.id=pcs.character_id
    WHERE pcs.player_id=? AND pcs.status='hidden' AND c.enabled=1
    ORDER BY c.priority DESC, c.created_at ASC LIMIT 1
  `).bind(playerId).first();
  if (!next) return null;

  await env.DB.batch([
    env.DB.prepare(`UPDATE player_character_state SET status='introduced', updated_at=? WHERE player_id=? AND character_id=?`).bind(now(), playerId, next.character_id),
    env.DB.prepare(`UPDATE player_state SET current_pool_size=current_pool_size+1, updated_at=? WHERE player_id=?`).bind(now(), playerId)
  ]);
  return next;
}

async function playerSnapshot(env, playerId) {
  await ensureState(env, playerId);
  const player = await env.DB.prepare(`SELECT p.*, f.name AS family_name FROM players p JOIN families f ON f.id=p.family_id WHERE p.id=?`).bind(playerId).first();
  if (!player) return null;
  const chars = await env.DB.prepare(`
    SELECT c.id,c.name,c.priority,pcs.status,pcs.times_shown,pcs.correct_count,pcs.wrong_count,pcs.score
    FROM player_character_state pcs JOIN characters c ON c.id=pcs.character_id
    WHERE pcs.player_id=? AND c.enabled=1
    ORDER BY CASE pcs.status WHEN 'introduced' THEN 0 WHEN 'active' THEN 1 WHEN 'familiar' THEN 2 ELSE 3 END, c.priority DESC, c.created_at ASC
  `).bind(playerId).all();
  const state = await env.DB.prepare(`SELECT * FROM player_state WHERE player_id=?`).bind(playerId).first();
  return { player, state, characters: chars.results.map(c => ({...c, image1:`/media/${c.id}/1`, image2:`/media/${c.id}/2`, audio:`/media/${c.id}/audio`})) };
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/health') return json({ ok: true, service: 'name-pairs-game' });

  if (request.method === 'POST' && path === '/api/bootstrap') {
    const body = await request.json();
    const familyId = id('fam'); const playerId = id('player');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO families(id,name) VALUES(?,?)`).bind(familyId, body.familyName || 'המשפחה שלי'),
      env.DB.prepare(`INSERT INTO players(id,family_id,name) VALUES(?,?,?)`).bind(playerId, familyId, body.playerName || 'שחקן'),
      env.DB.prepare(`INSERT INTO player_state(player_id) VALUES(?)`).bind(playerId)
    ]);
    return json({ familyId, playerId }, 201);
  }

  const playerMatch = path.match(/^\/api\/players\/([^/]+)\/state$/);
  if (request.method === 'GET' && playerMatch) {
    const snap = await playerSnapshot(env, playerMatch[1]);
    return snap ? json(snap) : json({ error: 'player_not_found' }, 404);
  }

  if (request.method === 'GET' && path.startsWith('/api/characters')) {
    const familyId = url.searchParams.get('familyId');
    if (!familyId) return json({ error: 'familyId_required' }, 400);
    const rows = await env.DB.prepare(`SELECT id,name,enabled,priority,created_at FROM characters WHERE family_id=? ORDER BY created_at DESC`).bind(familyId).all();
    return json(rows.results.map(c => ({...c,image1:`/media/${c.id}/1`,image2:`/media/${c.id}/2`,audio:`/media/${c.id}/audio`})));
  }

  if (request.method === 'POST' && path === '/api/characters') {
    const form = await request.formData();
    const familyId = form.get('familyId'); const name = String(form.get('name') || '').trim();
    const image1 = form.get('image1'); const image2 = form.get('image2'); const audio = form.get('audio');
    if (!familyId || !name || !(image1 instanceof File) || !(image2 instanceof File) || !(audio instanceof File)) {
      return json({ error: 'familyId_name_two_images_and_audio_required' }, 400);
    }
    const characterId = id('char');
    const base = `${familyId}/${characterId}`;
    const k1 = `${base}/image1`; const k2 = `${base}/image2`; const ka = `${base}/audio`;
    await Promise.all([
      env.MEDIA.put(k1, image1.stream(), { httpMetadata: { contentType: image1.type || 'image/jpeg' } }),
      env.MEDIA.put(k2, image2.stream(), { httpMetadata: { contentType: image2.type || 'image/jpeg' } }),
      env.MEDIA.put(ka, audio.stream(), { httpMetadata: { contentType: audio.type || 'audio/webm' } })
    ]);
    await env.DB.prepare(`INSERT INTO characters(id,family_id,name,image_1_key,image_2_key,audio_key) VALUES(?,?,?,?,?,?)`)
      .bind(characterId, familyId, name, k1, k2, ka).run();
    const players = await env.DB.prepare(`SELECT id FROM players WHERE family_id=?`).bind(familyId).all();
    for (const p of players.results) {
      await env.DB.prepare(`INSERT OR IGNORE INTO player_character_state(player_id,character_id) VALUES(?,?)`).bind(p.id, characterId).run();
      await ensureState(env, p.id);
    }
    return json({ id: characterId, name }, 201);
  }

  if (request.method === 'POST' && path === '/api/session/start') {
    const body = await request.json(); const sessionId = id('session');
    await env.DB.prepare(`INSERT INTO game_sessions(id,player_id,game_type) VALUES(?,?,?)`).bind(sessionId, body.playerId, body.gameType || 'find').run();
    return json({ sessionId }, 201);
  }

  if (request.method === 'POST' && path === '/api/events') {
    const b = await request.json();
    if (!b.playerId || !b.eventType) return json({ error: 'playerId_and_eventType_required' }, 400);
    await env.DB.prepare(`INSERT INTO game_events(session_id,player_id,event_type,character_id,selected_character_id,image_slot,result) VALUES(?,?,?,?,?,?,?)`)
      .bind(b.sessionId || null,b.playerId,b.eventType,b.characterId || null,b.selectedCharacterId || null,b.imageSlot || null,b.result || null).run();
    if (b.characterId && ['correct','wrong'].includes(b.result)) {
      const isCorrect = b.result === 'correct';
      const slot = Number(b.imageSlot) === 2 ? 2 : 1;
      await env.DB.prepare(`
        UPDATE player_character_state SET
          status = CASE WHEN status='introduced' THEN 'active' ELSE status END,
          times_shown=times_shown+1,
          correct_count=correct_count+?, wrong_count=wrong_count+?,
          image1_correct=image1_correct+?, image1_wrong=image1_wrong+?,
          image2_correct=image2_correct+?, image2_wrong=image2_wrong+?,
          score = CAST(correct_count + ? AS REAL) / MAX(1, correct_count + wrong_count + 1),
          last_seen=?, last_correct=CASE WHEN ?=1 THEN ? ELSE last_correct END, updated_at=?
        WHERE player_id=? AND character_id=?
      `).bind(
        isCorrect?1:0,isCorrect?0:1,
        isCorrect&&slot===1?1:0,!isCorrect&&slot===1?1:0,
        isCorrect&&slot===2?1:0,!isCorrect&&slot===2?1:0,
        isCorrect?1:0,now(),isCorrect?1:0,now(),now(),b.playerId,b.characterId
      ).run();
      if (!isCorrect && b.selectedCharacterId && b.selectedCharacterId !== b.characterId) {
        await env.DB.prepare(`
          INSERT INTO confusions(player_id,expected_character_id,selected_character_id,count,last_occurrence)
          VALUES(?,?,?,?,?)
          ON CONFLICT(player_id,expected_character_id,selected_character_id)
          DO UPDATE SET count=count+1,last_occurrence=excluded.last_occurrence
        `).bind(b.playerId,b.characterId,b.selectedCharacterId,1,now()).run();
      }
    }
    const unlocked = await maybeUnlock(env, b.playerId);
    return json({ ok: true, unlocked });
  }

  if (request.method === 'POST' && path === '/api/session/end') {
    const b = await request.json();
    await env.DB.batch([
      env.DB.prepare(`UPDATE game_sessions SET ended_at=?,score=?,completed=1 WHERE id=?`).bind(now(), b.score || 0, b.sessionId),
      env.DB.prepare(`UPDATE player_state SET games_played=games_played+1,last_session_at=?,updated_at=? WHERE player_id=?`).bind(now(),now(),b.playerId)
    ]);
    return json({ ok: true });
  }

  if (request.method === 'GET' && path === '/api/game/next') {
    const playerId = url.searchParams.get('playerId');
    if (!playerId) return json({ error:'playerId_required' },400);
    const snap = await playerSnapshot(env, playerId);
    if (!snap) return json({ error:'player_not_found' },404);
    const active = snap.characters.filter(c => c.status !== 'hidden');
    if (active.length < 2) return json({ type:'waiting_for_characters', characters:active });
    const weighted = [...active].sort((a,b) => (a.score - b.score) || (a.times_shown - b.times_shown));
    const target = weighted[0];
    const others = active.filter(c=>c.id!==target.id).sort(()=>Math.random()-.5).slice(0,3);
    const imageSlot = Math.random() < .5 ? 1 : 2;
    return json({ type:'find_character', target, imageSlot, options:[target,...others].sort(()=>Math.random()-.5) });
  }

  return json({ error: 'not_found' }, 404);
}

async function serveMedia(request, env, url) {
  const m = url.pathname.match(/^\/media\/([^/]+)\/(1|2|audio)$/);
  if (!m) return new Response('Not found', { status: 404 });
  const row = await env.DB.prepare(`SELECT image_1_key,image_2_key,audio_key FROM characters WHERE id=? AND enabled=1`).bind(m[1]).first();
  if (!row) return new Response('Not found', { status: 404 });
  const key = m[2] === '1' ? row.image_1_key : m[2] === '2' ? row.image_2_key : row.audio_key;
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers(); obj.writeHttpMetadata(headers); headers.set('etag', obj.httpEtag); headers.set('cache-control','private, max-age=3600');
  return new Response(obj.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      if (url.pathname.startsWith('/media/')) return await serveMedia(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({ error: 'internal_error', detail: String(e?.message || e) }, 500);
    }
  }
};
