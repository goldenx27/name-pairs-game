import app from './index.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

async function hashPin(pin) {
  const data = new TextEncoder().encode(String(pin));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyParentPin(env, familyId, pin) {
  if (!familyId || !pin) return false;
  const row = await env.DB.prepare('SELECT parent_pin_hash FROM families WHERE id=?').bind(familyId).first();
  return !!row?.parent_pin_hash && row.parent_pin_hash === await hashPin(pin);
}

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
  for (const [key, ref] of referenced) {
    if (!objectMap.has(key)) missing.push({ key, ...ref });
  }

  const orphaned = objects
    .filter(o => !referenced.has(o.key))
    .map(o => ({ ...o, key: o.key }));

  const referencedObjects = objects.filter(o => referenced.has(o.key));
  const totalBytes = objects.reduce((n, o) => n + o.size, 0);
  const referencedBytes = referencedObjects.reduce((n, o) => n + o.size, 0);
  const orphanedBytes = orphaned.reduce((n, o) => n + o.size, 0);

  const characters = rows.results.map(c => {
    const keys = [c.image_1_key, c.image_2_key, c.audio_key].filter(Boolean);
    const present = keys.filter(k => objectMap.has(k)).length;
    return {
      id: c.id,
      name: c.name,
      enabled: !!c.enabled,
      familyId: c.family_id,
      expectedFiles: keys.length,
      presentFiles: present,
      complete: present === keys.length,
      files: {
        image1: c.image_1_key ? !!objectMap.get(c.image_1_key) : false,
        image2: c.image_2_key ? !!objectMap.get(c.image_2_key) : false,
        audio: c.audio_key ? !!objectMap.get(c.audio_key) : false
      }
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      characters: characters.length,
      completeCharacters: characters.filter(c => c.complete).length,
      r2Objects: objects.length,
      referencedObjects: referencedObjects.length,
      orphanedObjects: orphaned.length,
      missingObjects: missing.length,
      totalBytes,
      referencedBytes,
      orphanedBytes
    },
    characters,
    missing,
    orphaned
  };
}

async function handleStorageApi(request, env, url) {
  if (!['/api/storage/audit', '/api/storage/cleanup'].includes(url.pathname)) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const body = await request.json().catch(() => ({}));
  if (!(await verifyParentPin(env, body.familyId, body.parentPin))) return json({ error: 'wrong_pin' }, 403);

  if (url.pathname === '/api/storage/audit') {
    return json(await storageAudit(env));
  }

  const audit = await storageAudit(env);
  const requested = Array.isArray(body.keys) ? body.keys : audit.orphaned.map(o => o.key);
  const allowed = new Set(audit.orphaned.map(o => o.key));
  const keys = requested.filter(k => allowed.has(k));
  if (!keys.length) return json({ ok: true, deleted: 0, deletedKeys: [] });

  for (let i = 0; i < keys.length; i += 1000) {
    await env.MEDIA.delete(keys.slice(i, i + 1000));
  }
  return json({ ok: true, deleted: keys.length, deletedKeys: keys });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const storageResponse = await handleStorageApi(request, env, url);
    if (storageResponse) return storageResponse;
    return app.fetch(request, env, ctx);
  }
};
