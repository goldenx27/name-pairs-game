import app from './index.js';
import { handleAuthApi, requireRole } from './auth.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

async function listAllObjects(bucket) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ limit: 1000, cursor });
    objects.push(...page.objects.map(o => ({
      key: o.key,
      size: Number(o.size || 0),
      uploaded: o.uploaded || null,
      etag: o.etag || null
    })));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

async function storageAudit(env) {
  const rows = await env.DB.prepare(`
    SELECT id,name,family_id,enabled,image_1_key,image_2_key,audio_key
    FROM characters
    ORDER BY created_at ASC
  `).all();

  const referenced = new Map();
  for (const c of rows.results) {
    for (const [kind, key] of [['image1', c.image_1_key], ['image2', c.image_2_key], ['audio', c.audio_key]]) {
      if (key) referenced.set(key, { characterId: c.id, name: c.name, kind, enabled: c.enabled, familyId: c.family_id });
    }
  }

  const objects = await listAllObjects(env.MEDIA);
  const objectMap = new Map(objects.map(o => [o.key, o]));
  const missing = [];
  for (const [key, ref] of referenced) if (!objectMap.has(key)) missing.push({ key, ...ref });
  const orphaned = objects.filter(o => !referenced.has(o.key));
  const referencedObjects = objects.filter(o => referenced.has(o.key));

  const characters = rows.results.map(c => {
    const keys = [c.image_1_key, c.image_2_key, c.audio_key].filter(Boolean);
    const present = keys.filter(k => objectMap.has(k)).length;
    return {
      id:c.id,name:c.name,enabled:!!c.enabled,familyId:c.family_id,
      expectedFiles:keys.length,presentFiles:present,complete:present===keys.length,
      files:{
        image1:c.image_1_key ? objectMap.has(c.image_1_key) : false,
        image2:c.image_2_key ? objectMap.has(c.image_2_key) : false,
        audio:c.audio_key ? objectMap.has(c.audio_key) : false
      }
    };
  });

  return {
    generatedAt:new Date().toISOString(),
    summary:{
      characters:characters.length,
      completeCharacters:characters.filter(c=>c.complete).length,
      r2Objects:objects.length,
      referencedObjects:referencedObjects.length,
      orphanedObjects:orphaned.length,
      missingObjects:missing.length,
      totalBytes:objects.reduce((n,o)=>n+o.size,0),
      referencedBytes:referencedObjects.reduce((n,o)=>n+o.size,0),
      orphanedBytes:orphaned.reduce((n,o)=>n+o.size,0)
    },
    characters,missing,orphaned
  };
}

async function handleStorageApi(request, env, url) {
  if (!['/api/storage/audit', '/api/storage/cleanup'].includes(url.pathname)) return null;
  const auth = await requireRole(request,env,['ADMIN']);
  if (auth.error) return auth.error;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (url.pathname === '/api/storage/audit') return json(await storageAudit(env));

  const body = await request.json().catch(() => ({}));
  const audit = await storageAudit(env);
  const requested = Array.isArray(body.keys) ? body.keys : audit.orphaned.map(o => o.key);
  const allowed = new Set(audit.orphaned.map(o => o.key));
  const keys = requested.filter(k => allowed.has(k));
  if (!keys.length) return json({ ok: true, deleted: 0, deletedKeys: [] });
  for (let i = 0; i < keys.length; i += 1000) await env.MEDIA.delete(keys.slice(i, i + 1000));
  return json({ ok: true, deleted: keys.length, deletedKeys: keys });
}

async function protectLegacyAdminRoutes(request,env,url){
  const mutatingCharacters = /^\/api\/characters(?:\/[^/]+)?$/.test(url.pathname) && ['POST','PATCH','DELETE'].includes(request.method);
  const resetPlayer = /^\/api\/players\/[^/]+\/reset$/.test(url.pathname) && request.method==='POST';
  if(!mutatingCharacters && !resetPlayer) return null;
  const roles = mutatingCharacters ? ['ADMIN'] : ['ADMIN','PARENT'];
  const auth=await requireRole(request,env,roles);
  if(auth.error) return auth.error;
  if(resetPlayer && auth.user.role==='PARENT'){
    const playerId=url.pathname.split('/')[3];
    const rel=await env.DB.prepare(`SELECT 1 FROM parent_children WHERE parent_user_id=? AND child_player_id=? LIMIT 1`).bind(auth.user.id,playerId).first();
    if(!rel) return json({error:'forbidden'},403);
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      const authResponse = await handleAuthApi(request,env,url);
      if (authResponse) return authResponse;

      const storageResponse = await handleStorageApi(request, env, url);
      if (storageResponse) return storageResponse;

      const protection = await protectLegacyAdminRoutes(request,env,url);
      if (protection) return protection;

      return app.fetch(request, env, ctx);
    } catch (e) {
      console.error(e);
      return json({error:'internal_error',detail:String(e?.message||e)},500);
    }
  }
};
