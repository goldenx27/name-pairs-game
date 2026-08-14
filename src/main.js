import app from './index.js';
import { handleAuthApi, requireRole } from './auth.js';
import { handleSpeechApi } from './speech.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});
const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const GLOBAL_FAMILY_ID='catalog_global';

async function listAllObjects(bucket) {
  const objects=[];let cursor;
  do{
    const page=await bucket.list({limit:1000,cursor});
    objects.push(...page.objects.map(o=>({key:o.key,size:Number(o.size||0),uploaded:o.uploaded||null,etag:o.etag||null})));
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  return objects;
}

async function storageAudit(env) {
  const rows=await env.DB.prepare(`SELECT id,name,family_id,enabled,image_1_key,image_2_key,audio_key FROM characters ORDER BY created_at ASC`).all();
  const referenced=new Map();
  for(const c of rows.results) for(const [kind,key] of [['image1',c.image_1_key],['image2',c.image_2_key],['audio',c.audio_key]]) if(key) referenced.set(key,{characterId:c.id,name:c.name,kind,enabled:c.enabled,familyId:c.family_id});
  const objects=await listAllObjects(env.MEDIA), objectMap=new Map(objects.map(o=>[o.key,o]));
  const missing=[];for(const [key,ref] of referenced) if(!objectMap.has(key)) missing.push({key,...ref});
  const orphaned=objects.filter(o=>!referenced.has(o.key));
  const referencedObjects=objects.filter(o=>referenced.has(o.key));
  const characters=rows.results.map(c=>{
    const keys=[c.image_1_key,c.image_2_key,c.audio_key].filter(Boolean),present=keys.filter(k=>objectMap.has(k)).length;
    return {id:c.id,name:c.name,enabled:!!c.enabled,familyId:c.family_id,expectedFiles:keys.length,presentFiles:present,complete:present===keys.length,files:{image1:c.image_1_key?objectMap.has(c.image_1_key):false,image2:c.image_2_key?objectMap.has(c.image_2_key):false,audio:c.audio_key?objectMap.has(c.audio_key):false}};
  });
  return {generatedAt:now(),summary:{characters:characters.length,completeCharacters:characters.filter(c=>c.complete).length,r2Objects:objects.length,referencedObjects:referencedObjects.length,orphanedObjects:orphaned.length,missingObjects:missing.length,totalBytes:objects.reduce((n,o)=>n+o.size,0),referencedBytes:referencedObjects.reduce((n,o)=>n+o.size,0),orphanedBytes:orphaned.reduce((n,o)=>n+o.size,0)},characters,missing,orphaned};
}

async function handleStorageApi(request,env,url){
  if(!['/api/storage/audit','/api/storage/cleanup'].includes(url.pathname)) return null;
  const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(url.pathname==='/api/storage/audit')return json(await storageAudit(env));
  const body=await request.json().catch(()=>({})),audit=await storageAudit(env);
  const requested=Array.isArray(body.keys)?body.keys:audit.orphaned.map(o=>o.key),allowed=new Set(audit.orphaned.map(o=>o.key)),keys=requested.filter(k=>allowed.has(k));
  for(let i=0;i<keys.length;i+=1000)await env.MEDIA.delete(keys.slice(i,i+1000));
  return json({ok:true,deleted:keys.length,deletedKeys:keys});
}

async function handleAdminMedia(request,env,url){
  const match=url.pathname.match(/^\/api\/characters(?:\/([^/]+))?$/);
  if(!match || !['POST','PATCH','DELETE'].includes(request.method)) return null;
  const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;

  if(request.method==='POST'&&!match[1]){
    const form=await request.formData();
    const name=String(form.get('name')||'').trim(),image1=form.get('image1'),image2=form.get('image2'),audio=form.get('audio');
    if(!name||!(image1 instanceof File)||!image1.size||!(image2 instanceof File)||!image2.size||!(audio instanceof File)||!audio.size)return json({error:'name_two_images_and_audio_required'},400);
    const characterId=id('char'),base=`${GLOBAL_FAMILY_ID}/${characterId}`,k1=`${base}/image1`,k2=`${base}/image2`,ka=`${base}/audio`;
    await Promise.all([
      env.MEDIA.put(k1,image1.stream(),{httpMetadata:{contentType:image1.type||'image/jpeg'}}),
      env.MEDIA.put(k2,image2.stream(),{httpMetadata:{contentType:image2.type||'image/jpeg'}}),
      env.MEDIA.put(ka,audio.stream(),{httpMetadata:{contentType:audio.type||'audio/webm'}})
    ]);
    await env.DB.prepare(`INSERT INTO characters(id,family_id,name,image_1_key,image_2_key,audio_key) VALUES(?,?,?,?,?,?)`).bind(characterId,GLOBAL_FAMILY_ID,name,k1,k2,ka).run();
    const players=await env.DB.prepare(`SELECT id FROM players`).all();
    for(const p of players.results)await env.DB.prepare(`INSERT OR IGNORE INTO player_character_state(player_id,character_id) VALUES(?,?)`).bind(p.id,characterId).run();
    return json({id:characterId,name},201);
  }

  const characterId=match[1];
  const row=await env.DB.prepare(`SELECT * FROM characters WHERE id=? AND family_id=?`).bind(characterId,GLOBAL_FAMILY_ID).first();
  if(!row)return json({error:'character_not_found'},404);

  if(request.method==='PATCH'){
    const form=await request.formData(),name=String(form.get('name')||row.name).trim();
    for(const [field,key,fallback] of [['image1',row.image_1_key,'image/jpeg'],['image2',row.image_2_key,'image/jpeg'],['audio',row.audio_key,'audio/webm']]){
      const file=form.get(field);if(file instanceof File&&file.size>0)await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:file.type||fallback}});
    }
    await env.DB.prepare(`UPDATE characters SET name=?,updated_at=? WHERE id=?`).bind(name,now(),characterId).run();
    return json({ok:true,id:characterId,name});
  }

  await Promise.all([env.MEDIA.delete(row.image_1_key),env.MEDIA.delete(row.image_2_key),env.MEDIA.delete(row.audio_key)]);
  await env.DB.prepare(`DELETE FROM characters WHERE id=?`).bind(characterId).run();
  return json({ok:true});
}

async function handleReset(request,env,url){
  const m=url.pathname.match(/^\/api\/players\/([^/]+)\/reset$/);if(!m||request.method!=='POST')return null;
  const auth=await requireRole(request,env,['ADMIN','PARENT']);if(auth.error)return auth.error;
  const playerId=m[1];
  if(auth.user.role==='PARENT'){
    const rel=await env.DB.prepare(`SELECT 1 FROM parent_children WHERE parent_user_id=? AND child_player_id=? LIMIT 1`).bind(auth.user.id,playerId).first();
    if(!rel)return json({error:'forbidden'},403);
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM confusions WHERE player_id=?`).bind(playerId),
    env.DB.prepare(`DELETE FROM game_events WHERE player_id=?`).bind(playerId),
    env.DB.prepare(`DELETE FROM game_sessions WHERE player_id=?`).bind(playerId),
    env.DB.prepare(`DELETE FROM player_character_state WHERE player_id=?`).bind(playerId),
    env.DB.prepare(`UPDATE player_state SET games_played=0,current_pool_size=2,rounds_since_unlock=0,last_character_id=NULL,last_game_type=NULL,last_session_at=NULL,updated_at=? WHERE player_id=?`).bind(now(),playerId)
  ]);
  const chars=await env.DB.prepare(`SELECT id FROM characters WHERE enabled=1 ORDER BY priority DESC,created_at ASC`).all();
  for(const c of chars.results)await env.DB.prepare(`INSERT OR IGNORE INTO player_character_state(player_id,character_id) VALUES(?,?)`).bind(playerId,c.id).run();
  return json({ok:true});
}

async function handleManagementExtras(request,env,url){
  if(request.method==='POST'&&url.pathname==='/api/manage/adopt-player'){
    const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;
    const b=await request.json().catch(()=>({}));
    const player=await env.DB.prepare(`SELECT id,family_id,name FROM players WHERE id=?`).bind(b.playerId).first();
    if(!player)return json({error:'player_not_found'},404);
    const existing=await env.DB.prepare(`SELECT ca.user_id,au.display_name FROM child_accounts ca JOIN app_users au ON au.id=ca.user_id WHERE ca.player_id=?`).bind(player.id).first();
    if(existing)return json({ok:true,alreadyAdopted:true,userId:existing.user_id,displayName:existing.display_name});
    const userId=id('user'),username=`child_${crypto.randomUUID().slice(0,8)}`,displayName=String(b.displayName||player.name||'ילד').trim();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO app_users(id,username,display_name,global_role,created_by) VALUES(?,?,?,'CHILD',?)`).bind(userId,username,displayName,auth.user.id),
      env.DB.prepare(`INSERT INTO child_accounts(user_id,player_id,family_id) VALUES(?,?,?)`).bind(userId,player.id,player.family_id),
      env.DB.prepare(`INSERT OR IGNORE INTO family_memberships(family_id,user_id,role,created_by) VALUES(?,?,'CHILD',?)`).bind(player.family_id,userId,auth.user.id),
      env.DB.prepare(`UPDATE players SET name=? WHERE id=?`).bind(displayName,player.id)
    ]);
    return json({ok:true,userId,playerId:player.id,displayName});
  }

  if(request.method==='GET'&&url.pathname==='/api/manage/parents'){
    const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;
    const rows=await env.DB.prepare(`
      SELECT u.id,u.username,u.display_name,fm.family_id,f.name family_name
      FROM app_users u
      LEFT JOIN family_memberships fm ON fm.user_id=u.id AND fm.role='PARENT' AND fm.active=1
      LEFT JOIN families f ON f.id=fm.family_id
      WHERE u.global_role='PARENT' AND u.active=1
      ORDER BY u.display_name
    `).all();
    return json(rows.results);
  }
  return null;
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      const speechResponse=await handleSpeechApi(request,env,url);if(speechResponse)return speechResponse;
      const authResponse=await handleAuthApi(request,env,url);if(authResponse)return authResponse;
      const extra=await handleManagementExtras(request,env,url);if(extra)return extra;
      const mediaResponse=await handleAdminMedia(request,env,url);if(mediaResponse)return mediaResponse;
      const storageResponse=await handleStorageApi(request,env,url);if(storageResponse)return storageResponse;
      const resetResponse=await handleReset(request,env,url);if(resetResponse)return resetResponse;
      return app.fetch(request,env,ctx);
    }catch(e){console.error(e);return json({error:'internal_error',detail:String(e?.message||e)},500);}
  }
};
