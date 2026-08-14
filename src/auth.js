const enc = new TextEncoder();

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});

const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const bytesToHex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = hex => new Uint8Array((hex.match(/.{1,2}/g) || []).map(x => parseInt(x, 16)));

async function sha256(value) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(value)))));
}

export async function hashPassword(password, saltHex = null) {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations:120000, hash:'SHA-256'}, key, 256);
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

function cookieToken(request) {
  const raw=request.headers.get('cookie')||'';
  for(const part of raw.split(';')){
    const [k,...rest]=part.trim().split('=');
    if(k==='crew_session') return decodeURIComponent(rest.join('='));
  }
  return '';
}
function setCookie(token,maxAge=60*60*24*30){
  return `crew_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function clearCookie(){ return 'crew_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'; }

export async function createSession(env, userId, userAgent='') {
  const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll('-','')}`;
  const tokenHash = await sha256(token);
  const sessionId = id('auth');
  const expiresAt = new Date(Date.now() + 30*24*60*60*1000).toISOString();
  await env.DB.prepare(`INSERT INTO auth_sessions(id,user_id,token_hash,expires_at,last_seen_at,user_agent) VALUES(?,?,?,?,?,?)`)
    .bind(sessionId,userId,tokenHash,expiresAt,now(),String(userAgent).slice(0,500)).run();
  return {token,expiresAt};
}

export async function currentUser(request, env) {
  const token = cookieToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id,u.username,u.display_name,u.global_role,u.active,s.id AS session_id,s.expires_at
    FROM auth_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND u.active=1 AND s.expires_at > CURRENT_TIMESTAMP
  `).bind(tokenHash).first();
  if (!row) return null;
  await env.DB.prepare(`UPDATE auth_sessions SET last_seen_at=? WHERE id=?`).bind(now(),row.session_id).run();
  return {id:row.id,username:row.username,displayName:row.display_name,role:row.global_role,sessionId:row.session_id};
}

export async function requireRole(request, env, roles) {
  const user=await currentUser(request,env);
  if(!user) return {error:json({error:'unauthorized'},401)};
  if(roles?.length && !roles.includes(user.role)) return {error:json({error:'forbidden'},403)};
  return {user};
}

async function verifyLegacyPin(env,familyId,pin){
  if(!familyId||!pin) return false;
  const row=await env.DB.prepare(`SELECT parent_pin_hash FROM families WHERE id=?`).bind(familyId).first();
  return !!row?.parent_pin_hash && row.parent_pin_hash===await sha256(pin);
}

async function createUser(env,{username,displayName,role,password,createdBy}){
  username=String(username||'').trim().toLowerCase();
  displayName=String(displayName||username).trim();
  if(!/^[a-z0-9._-]{3,40}$/i.test(username)) throw new Error('invalid_username');
  if(!['ADMIN','PARENT','CHILD'].includes(role)) throw new Error('invalid_role');
  if(role!=='CHILD' && String(password||'').length<6) throw new Error('password_too_short');
  const userId=id('user');
  let passwordHash=null,passwordSalt=null;
  if(role!=='CHILD'){
    const hp=await hashPassword(password);
    passwordHash=hp.hash;passwordSalt=hp.salt;
  }
  await env.DB.prepare(`INSERT INTO app_users(id,username,display_name,global_role,password_hash,password_salt,created_by) VALUES(?,?,?,?,?,?,?)`)
    .bind(userId,username,displayName,role,passwordHash,passwordSalt,createdBy||null).run();
  return {id:userId,username,displayName,role};
}

async function canSeePlayer(env,user,playerId){
  if(user.role==='ADMIN') return true;
  if(user.role!=='PARENT') return false;
  return !!(await env.DB.prepare(`SELECT 1 FROM parent_children WHERE parent_user_id=? AND child_player_id=? LIMIT 1`).bind(user.id,playerId).first());
}

export async function handleAuthApi(request,env,url){
  const path=url.pathname;

  if(request.method==='GET'&&path==='/api/auth/status'){
    const admin=await env.DB.prepare(`SELECT id FROM app_users WHERE global_role='ADMIN' AND active=1 LIMIT 1`).first();
    return json({needsAdminSetup:!admin,user:await currentUser(request,env)});
  }

  if(request.method==='POST'&&path==='/api/auth/setup-admin'){
    const existing=await env.DB.prepare(`SELECT id FROM app_users WHERE global_role='ADMIN' AND active=1 LIMIT 1`).first();
    if(existing) return json({error:'admin_already_exists'},409);
    const b=await request.json().catch(()=>({}));
    if(!(await verifyLegacyPin(env,b.familyId,b.pin))) return json({error:'wrong_pin'},403);
    try{
      const user=await createUser(env,{username:b.username,displayName:b.displayName||b.username,role:'ADMIN',password:b.password});
      const s=await createSession(env,user.id,request.headers.get('user-agent')||'');
      return json({user},201,{'set-cookie':setCookie(s.token)});
    }catch(e){return json({error:String(e.message||e)},400);}
  }

  if(request.method==='POST'&&path==='/api/auth/login'){
    const b=await request.json().catch(()=>({}));
    const username=String(b.username||'').trim().toLowerCase();
    const row=await env.DB.prepare(`SELECT * FROM app_users WHERE username=? AND active=1 AND global_role IN ('ADMIN','PARENT')`).bind(username).first();
    if(!row||!(await verifyPassword(String(b.password||''),row.password_salt,row.password_hash))) return json({error:'invalid_credentials'},401);
    const s=await createSession(env,row.id,request.headers.get('user-agent')||'');
    return json({user:{id:row.id,username:row.username,displayName:row.display_name,role:row.global_role}},200,{'set-cookie':setCookie(s.token)});
  }

  if(request.method==='POST'&&path==='/api/auth/logout'){
    const user=await currentUser(request,env);
    if(user) await env.DB.prepare(`DELETE FROM auth_sessions WHERE id=?`).bind(user.sessionId).run();
    return json({ok:true},200,{'set-cookie':clearCookie()});
  }

  if(request.method==='GET'&&path==='/api/auth/me'){
    const user=await currentUser(request,env);
    return user?json({user}):json({error:'unauthorized'},401);
  }

  if(request.method==='GET'&&path==='/api/manage/users'){
    const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;
    const rows=await env.DB.prepare(`SELECT id,username,display_name,global_role,active,created_at FROM app_users ORDER BY created_at DESC`).all();
    return json(rows.results);
  }

  if(request.method==='POST'&&path==='/api/manage/parents'){
    const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;
    const b=await request.json().catch(()=>({}));
    try{
      const parent=await createUser(env,{username:b.username,displayName:b.displayName||b.username,role:'PARENT',password:b.password,createdBy:auth.user.id});
      let familyId=String(b.familyId||'');
      if(!familyId){familyId=id('fam');await env.DB.prepare(`INSERT INTO families(id,name) VALUES(?,?)`).bind(familyId,b.familyName||`${parent.displayName} family`).run();}
      await env.DB.prepare(`INSERT OR IGNORE INTO family_memberships(family_id,user_id,role,created_by) VALUES(?,?,'PARENT',?)`).bind(familyId,parent.id,auth.user.id).run();
      return json({parent,familyId},201);
    }catch(e){return json({error:String(e.message||e)},400);}
  }

  if(request.method==='GET'&&path==='/api/manage/children'){
    const auth=await requireRole(request,env,['ADMIN','PARENT']);if(auth.error)return auth.error;
    const rows=auth.user.role==='ADMIN'
      ? await env.DB.prepare(`SELECT ca.player_id,au.id user_id,au.username,au.display_name,p.family_id,p.created_at FROM child_accounts ca JOIN app_users au ON au.id=ca.user_id JOIN players p ON p.id=ca.player_id WHERE au.active=1 ORDER BY au.display_name`).all()
      : await env.DB.prepare(`SELECT ca.player_id,au.id user_id,au.username,au.display_name,p.family_id,p.created_at FROM parent_children pc JOIN child_accounts ca ON ca.player_id=pc.child_player_id JOIN app_users au ON au.id=ca.user_id JOIN players p ON p.id=ca.player_id WHERE pc.parent_user_id=? AND au.active=1 ORDER BY au.display_name`).bind(auth.user.id).all();
    return json(rows.results);
  }

  if(request.method==='POST'&&path==='/api/manage/children'){
    const auth=await requireRole(request,env,['ADMIN','PARENT']);if(auth.error)return auth.error;
    const b=await request.json().catch(()=>({}));
    let familyId=String(b.familyId||'');
    if(auth.user.role==='PARENT'){
      const fm=await env.DB.prepare(`SELECT family_id FROM family_memberships WHERE user_id=? AND role='PARENT' AND active=1 LIMIT 1`).bind(auth.user.id).first();
      if(!fm)return json({error:'parent_has_no_family'},400);
      familyId=fm.family_id;
    }
    if(!familyId)return json({error:'family_required'},400);
    try{
      const child=await createUser(env,{username:b.username||`child_${crypto.randomUUID().slice(0,8)}`,displayName:b.displayName||'ילד',role:'CHILD',createdBy:auth.user.id});
      const playerId=id('player');
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO players(id,family_id,name) VALUES(?,?,?)`).bind(playerId,familyId,child.displayName),
        env.DB.prepare(`INSERT INTO player_state(player_id,current_pool_size) VALUES(?,2)`).bind(playerId),
        env.DB.prepare(`INSERT INTO child_accounts(user_id,player_id,family_id) VALUES(?,?,?)`).bind(child.id,playerId,familyId),
        env.DB.prepare(`INSERT OR IGNORE INTO family_memberships(family_id,user_id,role,created_by) VALUES(?,?,'CHILD',?)`).bind(familyId,child.id,auth.user.id)
      ]);
      if(auth.user.role==='PARENT') await env.DB.prepare(`INSERT OR IGNORE INTO parent_children(parent_user_id,child_player_id,family_id,created_by) VALUES(?,?,?,?)`).bind(auth.user.id,playerId,familyId,auth.user.id).run();
      if(auth.user.role==='ADMIN'&&b.parentUserId) await env.DB.prepare(`INSERT OR IGNORE INTO parent_children(parent_user_id,child_player_id,family_id,created_by) VALUES(?,?,?,?)`).bind(b.parentUserId,playerId,familyId,auth.user.id).run();
      return json({child,playerId,familyId},201);
    }catch(e){return json({error:String(e.message||e)},400);}
  }

  if(request.method==='POST'&&path==='/api/manage/assign-child'){
    const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;
    const b=await request.json().catch(()=>({}));
    const child=await env.DB.prepare(`SELECT family_id FROM child_accounts WHERE player_id=?`).bind(b.playerId).first();
    const parent=await env.DB.prepare(`SELECT fm.family_id FROM family_memberships fm JOIN app_users u ON u.id=fm.user_id WHERE fm.user_id=? AND fm.role='PARENT' AND fm.active=1 AND u.active=1`).bind(b.parentUserId).first();
    if(!child||!parent||child.family_id!==parent.family_id)return json({error:'parent_and_child_must_share_family'},400);
    await env.DB.prepare(`INSERT OR IGNORE INTO parent_children(parent_user_id,child_player_id,family_id,created_by) VALUES(?,?,?,?)`).bind(b.parentUserId,b.playerId,child.family_id,auth.user.id).run();
    return json({ok:true});
  }

  const unassign=path.match(/^\/api\/manage\/parents\/([^/]+)\/children\/([^/]+)$/);
  if(request.method==='DELETE'&&unassign){
    const auth=await requireRole(request,env,['ADMIN','PARENT']);if(auth.error)return auth.error;
    const parentId=unassign[1],playerId=unassign[2];
    if(auth.user.role==='PARENT'&&parentId!==auth.user.id)return json({error:'forbidden'},403);
    await env.DB.prepare(`DELETE FROM parent_children WHERE parent_user_id=? AND child_player_id=?`).bind(parentId,playerId).run();
    return json({ok:true});
  }

  const progress=path.match(/^\/api\/manage\/children\/([^/]+)\/progress$/);
  if(request.method==='GET'&&progress){
    const auth=await requireRole(request,env,['ADMIN','PARENT']);if(auth.error)return auth.error;
    const playerId=progress[1];
    if(!(await canSeePlayer(env,auth.user,playerId)))return json({error:'forbidden'},403);
    const chars=await env.DB.prepare(`SELECT c.id,c.name,pcs.status,pcs.times_shown,pcs.correct_count,pcs.wrong_count,pcs.score,pcs.image1_correct,pcs.image1_wrong,pcs.image2_correct,pcs.image2_wrong,pcs.last_seen FROM player_character_state pcs JOIN characters c ON c.id=pcs.character_id WHERE pcs.player_id=? AND c.enabled=1 ORDER BY c.priority DESC,c.created_at ASC`).bind(playerId).all();
    const state=await env.DB.prepare(`SELECT * FROM player_state WHERE player_id=?`).bind(playerId).first();
    return json({playerId,state,characters:chars.results});
  }

  if(request.method==='POST'&&path==='/api/manage/activate-child'){
    const auth=await requireRole(request,env,['ADMIN','PARENT']);if(auth.error)return auth.error;
    const b=await request.json().catch(()=>({}));
    if(!(await canSeePlayer(env,auth.user,b.playerId)))return json({error:'forbidden'},403);
    const p=await env.DB.prepare(`SELECT id,family_id,name FROM players WHERE id=?`).bind(b.playerId).first();
    return p?json({player:p}):json({error:'player_not_found'},404);
  }

  return null;
}
