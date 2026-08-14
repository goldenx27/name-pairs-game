const enc = new TextEncoder();

function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function hashPassword(password, saltHex = null) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:120000,hash:'SHA-256'}, key, 256);
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

export async function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  const {hash} = await hashPassword(password, salt);
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i=0;i<hash.length;i++) diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function createSession(env, userId, userAgent='') {
  const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-','')}`;
  const tokenHash = await sha256(token);
  const sessionId = `auth_${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,user_agent) VALUES(?,?,?,?,?)`)
    .bind(sessionId,userId,tokenHash,expiresAt,userAgent.slice(0,500)).run();
  return {token,expiresAt};
}

export async function currentUser(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id,u.username,u.display_name,u.global_role,u.active,s.id AS session_id,s.expires_at
    FROM auth_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND u.active=1 AND s.expires_at > CURRENT_TIMESTAMP
  `).bind(tokenHash).first();
  if (!row) return null;
  await env.DB.prepare(`UPDATE auth_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.session_id).run();
  return row;
}

export async function deleteSession(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return;
  await env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash=?`).bind(await sha256(token)).run();
}
