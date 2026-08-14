(() => {
  const $ = s => document.querySelector(s);
  let authUser=null;
  let adminFamilies=new Map();
  let parentsCache=[];
  let mediaEditId=null;

  async function api(path,opts={}){
    const r=await fetch(path,{credentials:'same-origin',...opts});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'request_failed');
    return d;
  }
  const post=(path,body)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hide=(el,on=true)=>el?.classList.toggle('hidden',on);

  function ensureModal(){if($('#accessModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="accessModal" class="accessModal hidden"><div class="accessCard"><div id="accessModalBody"></div></div></div>`);}
  async function status(){return api('/api/auth/status');}
  function translateError(e){return ({invalid_credentials:'שם משתמש או סיסמה שגויים',wrong_pin:'קוד ההורה שגוי',password_too_short:'הסיסמה חייבת להכיל לפחות 6 תווים',invalid_username:'שם המשתמש חייב להכיל 3–40 תווים באנגלית/מספרים',parent_and_child_must_share_family:'ההורה והילד חייבים להיות באותה משפחה',unauthorized:'יש להתחבר מחדש',forbidden:'אין הרשאה לפעולה'})[e]||e;}

  function showLogin(needsSetup){
    ensureModal();const body=$('#accessModalBody');
    if(needsSetup){
      body.innerHTML=`<h2>יצירת מנהל ראשי</h2><p class="muted">פעולה חד־פעמית. קוד ההורה הישן נדרש רק כדי לאשר שאתה מנהל המערכת הקיימת.</p><div class="accessGrid"><input id="setupDisplay" placeholder="שם תצוגה"><input id="setupUser" autocomplete="username" placeholder="שם משתמש"><input id="setupPass" type="password" autocomplete="new-password" placeholder="סיסמה (לפחות 6 תווים)"><input id="setupPin" inputmode="numeric" placeholder="קוד ההורה הקיים">${localStorage.playerId?'<input id="setupChildName" placeholder="שם הילד שכבר משחק במכשיר הזה">':''}<button id="setupAdminBtn">צור ADMIN</button><button id="accessCancel" class="ghost">ביטול</button><div id="accessErr" class="accessError"></div></div>`;
      $('#setupAdminBtn').onclick=async()=>{
        try{
          const d=await post('/api/auth/setup-admin',{familyId:localStorage.familyId,pin:$('#setupPin').value.trim(),username:$('#setupUser').value.trim(),displayName:$('#setupDisplay').value.trim(),password:$('#setupPass').value});
          authUser=d.user;
          if(localStorage.playerId){
            await post('/api/manage/adopt-player',{playerId:localStorage.playerId,displayName:$('#setupChildName')?.value.trim()||'הילד'}).catch(()=>{});
          }
          hide($('#accessModal'));await openManagement();
        }catch(e){$('#accessErr').textContent=translateError(e.message);}
      };
    }else{
      body.innerHTML=`<h2>כניסת הורה / מנהל</h2><div class="accessGrid"><input id="loginUser" autocomplete="username" placeholder="שם משתמש"><input id="loginPass" type="password" autocomplete="current-password" placeholder="סיסמה"><button id="loginBtn">כניסה</button><button id="accessCancel" class="ghost">ביטול</button><div id="accessErr" class="accessError"></div></div>`;
      $('#loginBtn').onclick=async()=>{try{const d=await post('/api/auth/login',{username:$('#loginUser').value.trim(),password:$('#loginPass').value});authUser=d.user;hide($('#accessModal'));await openManagement();}catch(e){$('#accessErr').textContent=translateError(e.message);}};
    }
    $('#accessCancel').onclick=()=>hide($('#accessModal'));hide($('#accessModal'),false);
  }

  function ensurePanel(){
    if($('#accessPanel'))return;
    document.querySelector('main.app').insertAdjacentHTML('beforeend',`<section id="accessPanel" class="card hidden accessPanel">
      <div class="accessTop"><div><h2>👥 ניהול משתמשים</h2><div id="signedUser" class="muted"></div></div><div class="accessActions"><button id="openMediaAdmin" class="ghost adminOnly">🖼️ תמונות וקולות</button><button id="logoutBtn" class="ghost">יציאה</button><button id="backToGame" class="ghost">חזרה למשחק</button></div></div>
      <div class="manageBox adminOnly"><h3>יצירת הורה</h3><div class="manageForm"><input id="newParentName" placeholder="שם תצוגה"><input id="newParentUser" placeholder="שם משתמש"><input id="newParentPass" type="password" placeholder="סיסמה"><input id="newFamilyName" placeholder="שם משפחה / קבוצה"><button id="createParentBtn" class="full">צור הורה</button></div></div>
      <div class="manageBox"><h3>הוספת ילד</h3><div class="manageForm"><input id="newChildName" placeholder="שם הילד"><input id="newChildUser" placeholder="מזהה פנימי (אופציונלי)"><select id="childParentSelect" class="adminOnly"><option value="">בחר הורה</option></select><button id="createChildBtn" class="full">הוסף ילד</button></div><div id="childCreateHint" class="muted"></div></div>
      <div class="manageBox adminOnly"><h3>משתמשים</h3><div id="userRows" class="userRows"></div></div>
      <div class="manageBox"><h3 id="childrenTitle">ילדים</h3><div id="childRows" class="childRows"></div></div>
    </section>`);
    $('#logoutBtn').onclick=logout;$('#backToGame').onclick=backToGame;$('#openMediaAdmin').onclick=openMediaAdmin;$('#createParentBtn').onclick=createParent;$('#createChildBtn').onclick=createChild;
  }

  function setRoleUi(){document.querySelectorAll('.adminOnly').forEach(el=>el.classList.toggle('hidden',authUser?.role!=='ADMIN'));$('#signedUser').textContent=`${authUser?.displayName||authUser?.username} · ${authUser?.role==='ADMIN'?'ADMIN':'הורה'}`;$('#childrenTitle').textContent=authUser?.role==='ADMIN'?'כל הילדים':'הילדים שלי';}
  async function openManagement(){ensurePanel();setRoleUi();hide($('#game'));hide($('#crew'));hide($('#parent'));hide($('#setup'));hide($('#accessPanel'),false);$('#modeBtn').textContent='🔓 ניהול';await refreshManagement();}
  function backToGame(){hide($('#accessPanel'));hide($('#parent'));if(localStorage.playerId){hide($('#game'),false);hide($('#crew'),false);}else hide($('#setup'),false);$('#modeBtn').textContent='🔒 אזור הורה';}
  async function logout(){await post('/api/auth/logout',{}).catch(()=>{});authUser=null;adminFamilies.clear();parentsCache=[];backToGame();}

  async function refreshManagement(){if(authUser.role==='ADMIN')await loadUsers();await loadChildren();}
  async function loadUsers(){
    const [users,parents]=await Promise.all([api('/api/manage/users'),api('/api/manage/parents')]);
    parentsCache=parents;adminFamilies=new Map(parents.map(p=>[p.id,p.family_id]));
    $('#userRows').innerHTML=users.map(u=>`<div class="userRow"><div><b>${esc(u.display_name)}</b><br><small>${esc(u.username)}</small></div><span class="roleBadge">${u.global_role}</span></div>`).join('')||'<div class="muted">אין משתמשים</div>';
    $('#childParentSelect').innerHTML='<option value="">בחר הורה</option>'+parents.map(p=>`<option value="${p.id}">${esc(p.display_name)} (${esc(p.username)})</option>`).join('');
  }

  function parentSelectHtml(){return `<select class="assignParent"><option value="">שייך להורה…</option>${parentsCache.map(p=>`<option value="${p.id}">${esc(p.display_name)}</option>`).join('')}</select>`;}
  async function loadChildren(){
    const children=await api('/api/manage/children');
    $('#childRows').innerHTML=children.map(c=>`<div class="childRow" data-player="${c.player_id}"><div><b>${esc(c.display_name)}</b><br><small>${esc(c.username)}</small><div class="progressMini hidden"></div></div><div class="accessActions"><button class="playChild ghost">🎮 שחק</button><button class="showProgress ghost">📊 התקדמות</button>${authUser.role==='PARENT'?'<button class="removeChild ghost">הסר</button>':`${parentSelectHtml()}<button class="assignChild ghost">שייך</button>`}</div></div>`).join('')||'<div class="muted">עדיין אין ילדים</div>';
    document.querySelectorAll('.childRow').forEach(row=>{row.querySelector('.playChild').onclick=()=>activateChild(row.dataset.player);row.querySelector('.showProgress').onclick=()=>toggleProgress(row);row.querySelector('.removeChild')?.addEventListener('click',()=>removeChild(row.dataset.player));row.querySelector('.assignChild')?.addEventListener('click',()=>assignChild(row));});
  }

  async function createParent(){
    try{const d=await post('/api/manage/parents',{displayName:$('#newParentName').value.trim(),username:$('#newParentUser').value.trim(),password:$('#newParentPass').value,familyName:$('#newFamilyName').value.trim()});$('#newParentName').value=$('#newParentUser').value=$('#newParentPass').value=$('#newFamilyName').value='';await loadUsers();$('#childParentSelect').value=d.parent.id;$('#childCreateHint').textContent='ההורה נוצר. אפשר להוסיף לו ילד.';}catch(e){alert(translateError(e.message));}
  }
  async function createChild(){
    const body={displayName:$('#newChildName').value.trim(),username:$('#newChildUser').value.trim()||undefined};
    if(!body.displayName)return alert('הכנס שם לילד');
    if(authUser.role==='ADMIN'){const parentId=$('#childParentSelect').value;if(!parentId)return alert('בחר הורה שאליו הילד ישויך');body.parentUserId=parentId;body.familyId=adminFamilies.get(parentId);}
    try{await post('/api/manage/children',body);$('#newChildName').value=$('#newChildUser').value='';await loadChildren();}catch(e){alert(translateError(e.message));}
  }
  async function assignChild(row){const parentId=row.querySelector('.assignParent').value;if(!parentId)return alert('בחר הורה');try{await post('/api/manage/assign-child',{parentUserId:parentId,playerId:row.dataset.player});alert('הילד שויך להורה');}catch(e){alert(translateError(e.message));}}
  async function activateChild(playerId){const d=await post('/api/manage/activate-child',{playerId});localStorage.playerId=d.player.id;localStorage.familyId=d.player.family_id;location.reload();}
  async function toggleProgress(row){const panel=row.querySelector('.progressMini');if(!panel.classList.contains('hidden')){panel.classList.add('hidden');return;}panel.textContent='טוען…';panel.classList.remove('hidden');try{const d=await api(`/api/manage/children/${row.dataset.player}/progress`);const chars=d.characters.filter(c=>c.status!=='hidden');panel.innerHTML=chars.length?chars.map(c=>{const total=Number(c.correct_count||0)+Number(c.wrong_count||0),pct=total?Math.round(Number(c.correct_count||0)*100/total):0;return `<div class="progressMiniRow"><span>${esc(c.name)}</span><div class="progressTrack"><div class="progressFill" style="width:${pct}%"></div></div><b>${pct}%</b></div>`}).join(''):'<span class="muted">עדיין אין מספיק נתוני משחק</span>';}catch(e){panel.textContent=translateError(e.message);}}
  async function removeChild(playerId){if(!confirm('להסיר את הילד מרשימת הילדים שלך? ההתקדמות לא תימחק.'))return;await api(`/api/manage/parents/${authUser.id}/children/${playerId}`,{method:'DELETE'});await loadChildren();}

  async function loadMediaList(){
    const chars=await api('/api/characters');
    $('#adminList').innerHTML=chars.map(c=>`<div class="adminItem" data-id="${c.id}"><img src="${c.image1}" alt=""><b>${esc(c.name)}</b><div class="adminBtns"><button class="mediaEdit ghost">✏️ ערוך</button><button class="mediaDelete danger">🗑️ מחק</button></div></div>`).join('');
    document.querySelectorAll('#adminList .adminItem').forEach(el=>{const c=chars.find(x=>x.id===el.dataset.id);el.querySelector('.mediaEdit').onclick=()=>startMediaEdit(c);el.querySelector('.mediaDelete').onclick=()=>deleteMedia(c);});
  }
  function startMediaEdit(c){mediaEditId=c.id;$('#characterName').value=c.name;$('#saveCharacterBtn').textContent='שמור שינויים';hide($('#cancelEditBtn'),false);window.scrollTo({top:0,behavior:'smooth'});}
  function resetMediaForm(){mediaEditId=null;$('#characterForm').reset();$('#saveCharacterBtn').textContent='הוסף לחבורה';hide($('#cancelEditBtn'));$('#recordStatus').textContent='';}
  async function mediaSubmit(e){e.preventDefault();const fd=new FormData(e.currentTarget);const btn=$('#saveCharacterBtn');btn.disabled=true;try{if(mediaEditId)await api(`/api/characters/${mediaEditId}`,{method:'PATCH',body:fd});else await api('/api/characters',{method:'POST',body:fd});resetMediaForm();await loadMediaList();}catch(err){alert(translateError(err.message));}finally{btn.disabled=false;}}
  async function deleteMedia(c){if(!confirm(`למחוק את ${c.name} מהמאגר הגלובלי?`))return;try{await api(`/api/characters/${c.id}`,{method:'DELETE',headers:{'content-type':'application/json'},body:'{}'});await loadMediaList();}catch(e){alert(translateError(e.message));}}
  async function resetActiveChild(){if(!localStorage.playerId)return alert('בחר קודם ילד דרך ניהול המשתמשים');if(!confirm('לאפס את ההתקדמות של הילד הפעיל?'))return;try{await post(`/api/players/${localStorage.playerId}/reset`,{});alert('ההתקדמות אופסה');}catch(e){alert(translateError(e.message));}}
  async function openMediaAdmin(){
    if(authUser?.role!=='ADMIN')return;
    hide($('#accessPanel'));hide($('#game'));hide($('#crew'));hide($('#setup'));hide($('#parent'),false);$('#modeBtn').textContent='🔓 ADMIN';
    $('#closeParent').onclick=()=>openManagement();$('#characterForm').onsubmit=mediaSubmit;$('#cancelEditBtn').onclick=resetMediaForm;$('#resetProgressBtn').onclick=resetActiveChild;
    await loadMediaList();
  }

  async function openAccess(){try{const s=await status();authUser=s.user||null;if(authUser)return openManagement();showLogin(s.needsAdminSetup);}catch(e){alert(e.message);}}
  window.addEventListener('DOMContentLoaded',()=>{ensureModal();ensurePanel();$('#modeBtn')?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openAccess();},true);});
})();
