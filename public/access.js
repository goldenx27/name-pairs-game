(() => {
  const $ = s => document.querySelector(s);
  let authUser=null;
  let adminFamilies=new Map();
  let parentsCache=[];
  let mediaEditId=null;

  async function api(path,opts={}){const r=await fetch(path,{credentials:'same-origin',...opts});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'request_failed');return d;}
  const post=(path,body)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hide=(el,on=true)=>el?.classList.toggle('hidden',on);
  const roleLabel=r=>r==='ADMIN'?'מנהל':r==='PARENT'?'הורה':'ילד';
  const setTopButton=()=>{if($('#modeBtn'))$('#modeBtn').textContent=authUser?'יציאה':'🔒 ניהול';};

  function ensureModal(){if($('#accessModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="accessModal" class="accessModal hidden"><div class="accessCard"><div id="accessModalBody"></div></div></div>`);}
  async function status(){return api('/api/auth/status');}
  function translateError(e){return ({invalid_credentials:'שם משתמש או סיסמה שגויים',wrong_pin:'קוד ההורה שגוי',password_too_short:'הסיסמה חייבת להכיל לפחות 6 תווים',invalid_username:'שם המשתמש חייב להכיל 3–40 תווים באנגלית/מספרים',unauthorized:'יש להתחבר מחדש',forbidden:'אין הרשאה לפעולה',cannot_delete_current_admin:'אי אפשר למחוק את המנהל שמחובר כרגע',user_not_found:'המשתמש לא נמצא'})[e]||e;}

  function showLogin(needsSetup){
    ensureModal();const body=$('#accessModalBody');
    if(needsSetup){body.innerHTML=`<h2>יצירת מנהל ראשי</h2><p class="muted">פעולה חד־פעמית. קוד ההורה הישן נדרש רק כדי לאשר שאתה מנהל המערכת הקיימת.</p><div class="accessGrid"><input id="setupDisplay" placeholder="שם תצוגה"><input id="setupUser" autocomplete="username" placeholder="שם משתמש"><input id="setupPass" type="password" autocomplete="new-password" placeholder="סיסמה (לפחות 6 תווים)"><input id="setupPin" inputmode="numeric" placeholder="קוד ההורה הקיים">${localStorage.playerId?'<input id="setupChildName" placeholder="שם הילד שכבר משחק במכשיר הזה">':''}<button id="setupAdminBtn">צור ADMIN</button><button id="accessCancel" class="ghost">ביטול</button><div id="accessErr" class="accessError"></div></div>`;$('#setupAdminBtn').onclick=async()=>{try{const d=await post('/api/auth/setup-admin',{familyId:localStorage.familyId,pin:$('#setupPin').value.trim(),username:$('#setupUser').value.trim(),displayName:$('#setupDisplay').value.trim(),password:$('#setupPass').value});authUser=d.user;if(localStorage.playerId){await post('/api/manage/adopt-player',{playerId:localStorage.playerId,displayName:$('#setupChildName')?.value.trim()||'הילד'}).catch(()=>{});}hide($('#accessModal'));await openManagement();}catch(e){$('#accessErr').textContent=translateError(e.message);}};}
    else{body.innerHTML=`<h2>כניסת הורה / מנהל</h2><div class="accessGrid"><input id="loginUser" autocomplete="username" placeholder="שם משתמש"><input id="loginPass" type="password" autocomplete="current-password" placeholder="סיסמה"><button id="loginBtn">כניסה</button><button id="accessCancel" class="ghost">ביטול</button><div id="accessErr" class="accessError"></div></div>`;$('#loginBtn').onclick=async()=>{try{const d=await post('/api/auth/login',{username:$('#loginUser').value.trim(),password:$('#loginPass').value});authUser=d.user;hide($('#accessModal'));await openManagement();}catch(e){$('#accessErr').textContent=translateError(e.message);}};}
    $('#accessCancel').onclick=()=>hide($('#accessModal'));hide($('#accessModal'),false);
  }

  function ensurePanel(){
    if($('#accessPanel'))return;
    document.querySelector('main.app').insertAdjacentHTML('beforeend',`<section id="accessPanel" class="card hidden accessPanel">
      <div class="accessTop adminSectionTop"><div class="adminSectionHeading"><h2>👥 ניהול משתמשים</h2><div id="signedUser" class="muted"></div></div><div class="accessActions"><button id="openMediaAdmin" class="ghost adminOnly sectionNavBtn">📊 נתונים</button></div></div>
      <div id="activeChildBanner" class="activeChildBanner"></div>
      <details class="manageBox adminOnly"><summary>➕ יצירת הורה</summary><div class="manageBody"><div class="manageForm"><input id="newParentName" placeholder="שם תצוגה"><input id="newParentUser" placeholder="שם משתמש"><input id="newParentPass" type="password" placeholder="סיסמה"><input id="newFamilyName" placeholder="שם משפחה / קבוצה"><button id="createParentBtn" class="full">צור הורה</button></div></div></details>
      <details class="manageBox"><summary>➕ הוספת ילד</summary><div class="manageBody"><div class="manageForm"><input id="newChildName" placeholder="שם הילד"><input id="newChildUser" placeholder="מזהה פנימי (אופציונלי)"><select id="childParentSelect" class="adminOnly"><option value="">בחר הורה</option></select><button id="createChildBtn" class="full">הוסף ילד</button></div><div id="childCreateHint" class="muted"></div></div></details>
      <details class="manageBox adminOnly"><summary>👤 משתמשים פעילים</summary><div class="manageBody"><div id="userRows" class="userRows"></div></div></details>
      <details class="manageBox"><summary id="childrenTitle">👦 ילדים</summary><div class="manageBody"><div id="childRows" class="childRows"></div></div></details>
    </section>`);
    $('#openMediaAdmin').onclick=openMediaAdmin;$('#createParentBtn').onclick=createParent;$('#createChildBtn').onclick=createChild;
  }

  function setRoleUi(){document.querySelectorAll('.adminOnly').forEach(el=>el.classList.toggle('hidden',authUser?.role!=='ADMIN'));$('#signedUser').textContent=`${authUser?.displayName||authUser?.username} · ${authUser?.role==='ADMIN'?'ADMIN':'הורה'}`;$('#childrenTitle').textContent=authUser?.role==='ADMIN'?'👦 כל הילדים':'👦 הילדים שלי';}
  async function openManagement(){ensurePanel();setRoleUi();hide($('#game'));hide($('#crew'));hide($('#parent'));hide($('#setup'));hide($('#accessPanel'),false);setTopButton();await refreshManagement();}
  function backToGame(){hide($('#accessPanel'));hide($('#parent'));window.clearProgressDashboard?.();if(localStorage.playerId){hide($('#game'),false);hide($('#crew'),false);}else hide($('#setup'),false);setTopButton();}
  async function logout(){await post('/api/auth/logout',{}).catch(()=>{});authUser=null;adminFamilies.clear();parentsCache=[];backToGame();}

  async function refreshManagement(){if(authUser.role==='ADMIN')await loadUsers();await loadChildren();}
  function userRow(u){return `<div class="userRow"><div><b>${esc(u.display_name)}</b><br><small>${esc(u.username)}</small></div><div class="userActions"><span class="roleBadge">${roleLabel(u.global_role)}</span>${u.id!==authUser.id?`<button class="deleteUser danger" data-id="${u.id}" data-name="${esc(u.display_name)}">מחק</button>`:''}</div></div>`;}
  async function loadUsers(){
    const [users,parents]=await Promise.all([api('/api/manage/users'),api('/api/manage/parents')]);
    parentsCache=parents;adminFamilies=new Map(parents.map(p=>[p.id,p.family_id]));
    const admins=users.filter(u=>u.global_role==='ADMIN'), parentUsers=users.filter(u=>u.global_role==='PARENT');
    const group=(title,items)=>`<div class="userGroup"><h4>${title} <span>${items.length}</span></h4>${items.length?items.map(userRow).join(''):'<div class="muted userGroupEmpty">אין משתמשים</div>'}</div>`;
    $('#userRows').innerHTML=`${group('👨‍👩‍👧 הורים',parentUsers)}${admins.length?group('🔑 מנהלים',admins):''}`;
    document.querySelectorAll('.deleteUser').forEach(b=>b.onclick=()=>deleteUser(b.dataset.id,b.dataset.name));
    $('#childParentSelect').innerHTML='<option value="">בחר הורה</option>'+parents.map(p=>`<option value="${p.id}">${esc(p.display_name)} (${esc(p.username)})</option>`).join('');
  }
  function parentSelectHtml(currentParentId){return `<select class="assignParent">${parentsCache.map(p=>`<option value="${p.id}" ${p.id===currentParentId?'selected':''}>${esc(p.display_name)}</option>`).join('')}</select>`;}
  async function loadChildren(){
    const children=await api('/api/manage/children');
    const active=children.find(c=>c.player_id===localStorage.playerId);
    $('#activeChildBanner').innerHTML=active?`<span>🎮 ילד פעיל</span><b>${esc(active.display_name)}</b><small>${active.parent_name?`משויך ל: ${esc(active.parent_name)}`:'לא משויך להורה'}</small>`:`<span>🎮 ילד פעיל</span><b>לא נבחר ילד</b><small>בחר "הפוך לפעיל" ליד ילד כדי להפוך אותו לילד הפעיל במכשיר הזה.</small>`;
    $('#childRows').innerHTML=children.map(c=>`<div class="childRow ${c.player_id===localStorage.playerId?'activeChildRow':''}" data-player="${c.player_id}" data-name="${esc(c.display_name)}"><div><b>${esc(c.display_name)} ${c.player_id===localStorage.playerId?'<span class="activePill">פעיל</span>':''}</b><br><small>${esc(c.username)}</small><div class="assignmentLine">${c.parent_name?`משויך ל: <b>${esc(c.parent_name)}</b>`:'לא משויך להורה'}${c.family_name?` · קבוצה: ${esc(c.family_name)}`:''}</div></div><div class="accessActions"><button class="playChild ghost">🎮 הפוך לפעיל</button><button class="showProgress ghost">📊 התקדמות</button>${authUser.role==='PARENT'?'<button class="removeChild ghost">הסר</button>':`${parentSelectHtml(c.parent_user_id)}<button class="assignChild ghost">שמור שיוך</button>`}</div></div>`).join('')||'<div class="muted">עדיין אין ילדים</div>';
    document.querySelectorAll('.childRow').forEach(row=>{row.querySelector('.playChild').onclick=()=>activateChild(row.dataset.player);row.querySelector('.showProgress').onclick=()=>showChildProgress(row);row.querySelector('.removeChild')?.addEventListener('click',()=>removeChild(row.dataset.player));row.querySelector('.assignChild')?.addEventListener('click',()=>assignChild(row));});
  }

  async function createParent(){try{const d=await post('/api/manage/parents',{displayName:$('#newParentName').value.trim(),username:$('#newParentUser').value.trim(),password:$('#newParentPass').value,familyName:$('#newFamilyName').value.trim()});$('#newParentName').value=$('#newParentUser').value=$('#newParentPass').value=$('#newFamilyName').value='';await loadUsers();$('#childParentSelect').value=d.parent.id;$('#childCreateHint').textContent='ההורה נוצר. אפשר להוסיף לו ילד.';}catch(e){alert(translateError(e.message));}}
  async function createChild(){const body={displayName:$('#newChildName').value.trim(),username:$('#newChildUser').value.trim()||undefined};if(!body.displayName)return alert('הכנס שם לילד');if(authUser.role==='ADMIN'){const parentId=$('#childParentSelect').value;if(!parentId)return alert('בחר הורה שאליו הילד ישויך');body.parentUserId=parentId;body.familyId=adminFamilies.get(parentId);}try{await post('/api/manage/children',body);$('#newChildName').value=$('#newChildUser').value='';await refreshManagement();}catch(e){alert(translateError(e.message));}}
  async function assignChild(row){const parentId=row.querySelector('.assignParent').value;if(!parentId)return alert('בחר הורה');try{await post('/api/manage/assign-child',{parentUserId:parentId,playerId:row.dataset.player});await loadChildren();alert('השיוך עודכן');}catch(e){alert(translateError(e.message));}}
  async function deleteUser(userId,name){if(!confirm(`להסיר את ${name}? המשתמש יושבת, והיסטוריית ילד לא תימחק.`))return;try{await api(`/api/manage/users/${userId}`,{method:'DELETE'});await refreshManagement();}catch(e){alert(translateError(e.message));}}
  async function activateChild(playerId){const d=await post('/api/manage/activate-child',{playerId});localStorage.playerId=d.player.id;localStorage.familyId=d.player.family_id;location.reload();}
  async function showChildProgress(row){if(!window.renderProgressDashboard)return;hide($('#accessPanel'));hide($('#game'));hide($('#crew'));hide($('#setup'));hide($('#parent'),false);$('#parent h2').textContent=`📊 התקדמות — ${row.dataset.name}`;$('#closeParent').textContent='👥 משתמשים';$('#closeParent').onclick=()=>openManagement();document.querySelectorAll('#parent > :not(.adminSectionTop):not(#progressPanel)').forEach(el=>el.classList.add('adminMediaHidden'));$('#progressPanel').classList.remove('adminMediaHidden');setTopButton();await window.renderProgressDashboard(row.dataset.player,row.dataset.name);}
  async function removeChild(playerId){if(!confirm('להסיר את הילד מרשימת הילדים שלך? ההתקדמות לא תימחק.'))return;await api(`/api/manage/parents/${authUser.id}/children/${playerId}`,{method:'DELETE'});await loadChildren();}

  async function loadMediaList(){
    const chars=await api('/api/characters');
    $('#adminList').innerHTML=chars.map(c=>`<article class="crewAdminCard" data-id="${c.id}"><div class="crewAdminImages"><img src="${c.image1}" alt="${esc(c.name)} תמונה 1"><img src="${c.image2}" alt="${esc(c.name)} תמונה 2"></div><h4>${esc(c.name)}</h4><div class="adminBtns"><button class="mediaEdit ghost">✏️ ערוך</button><button class="mediaDelete danger">🗑️ מחק</button></div></article>`).join('')||'<div class="muted">עדיין אין דמויות בחבורה</div>';
    document.querySelectorAll('#adminList .crewAdminCard').forEach(el=>{const c=chars.find(x=>x.id===el.dataset.id);el.querySelector('.mediaEdit').onclick=()=>startMediaEdit(c);el.querySelector('.mediaDelete').onclick=()=>deleteMedia(c);});
  }
  function startMediaEdit(c){mediaEditId=c.id;$('#characterName').value=c.name;$('#saveCharacterBtn').textContent='שמור שינויים';hide($('#cancelEditBtn'),false);const details=$('#characterEditorDetails');if(details)details.open=true;details?.scrollIntoView({behavior:'smooth',block:'start'});}
  function resetMediaForm(){mediaEditId=null;$('#characterForm').reset();$('#saveCharacterBtn').textContent='הוסף לחבורה';hide($('#cancelEditBtn'));$('#recordStatus').textContent='';}
  async function mediaSubmit(e){e.preventDefault();const fd=new FormData(e.currentTarget);const btn=$('#saveCharacterBtn');btn.disabled=true;try{if(mediaEditId)await api(`/api/characters/${mediaEditId}`,{method:'PATCH',body:fd});else await api('/api/characters',{method:'POST',body:fd});resetMediaForm();if($('#characterEditorDetails'))$('#characterEditorDetails').open=false;await loadMediaList();}catch(err){alert(translateError(err.message));}finally{btn.disabled=false;}}
  async function deleteMedia(c){if(!confirm(`למחוק את ${c.name} מהמאגר הגלובלי?`))return;try{await api(`/api/characters/${c.id}`,{method:'DELETE',headers:{'content-type':'application/json'},body:'{}'});await loadMediaList();}catch(e){alert(translateError(e.message));}}
  async function resetActiveChild(){if(!localStorage.playerId)return alert('בחר קודם ילד דרך ניהול המשתמשים');if(!confirm('לאפס את ההתקדמות של הילד הפעיל?'))return;try{await post(`/api/players/${localStorage.playerId}/reset`,{});alert('ההתקדמות אופסה');}catch(e){alert(translateError(e.message));}}
  async function openMediaAdmin(){if(authUser?.role!=='ADMIN')return;hide($('#accessPanel'));hide($('#game'));hide($('#crew'));hide($('#setup'));hide($('#parent'),false);$('#parent h2').textContent='📊 נתונים';if($('#dataSignedUser'))$('#dataSignedUser').textContent=`${authUser?.displayName||authUser?.username} · ADMIN`;$('#closeParent').textContent='👥 משתמשים';$('#closeParent').onclick=()=>openManagement();document.querySelectorAll('#parent > *').forEach(el=>el.classList.remove('adminMediaHidden'));$('#progressPanel').classList.add('adminMediaHidden');if($('#characterEditorDetails'))$('#characterEditorDetails').open=false;$('#characterForm').onsubmit=mediaSubmit;$('#cancelEditBtn').onclick=resetMediaForm;$('#resetProgressBtn').onclick=resetActiveChild;setTopButton();await loadMediaList();}

  async function openAccess(){try{const s=await status();authUser=s.user||null;if(authUser)return openManagement();showLogin(s.needsAdminSetup);}catch(e){alert(e.message);}}
  async function handleTopButton(){if(authUser)return logout();return openAccess();}
  window.addEventListener('DOMContentLoaded',()=>{ensureModal();ensurePanel();setTopButton();$('#modeBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();handleTopButton();},true);});
})();