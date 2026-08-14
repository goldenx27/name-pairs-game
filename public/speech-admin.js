(() => {
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  let editId=null;

  async function api(path,opts={}){const r=await fetch(path,{credentials:'same-origin',...opts});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'request_failed');return d;}
  function ensureUi(){
    if($('#speechPracticeAdmin'))return;
    const anchor=$('#characterEditorDetails');if(!anchor)return;
    anchor.insertAdjacentHTML('afterend',`<details id="speechPracticeAdmin" class="manageBox dataManageBox"><summary>🗣️ תרגילי דיבור — תשתית</summary><div class="manageBody"><p class="muted">תמונה אחת + הקלטת משפט + יעד שהילד אמור לחזור עליו. התרגילים עדיין לא נכנסים אוטומטית לסבב המשחק.</p><form id="speechItemForm"><label>שם התרגיל<input id="speechTitle" name="title" placeholder="למשל: אות ש׳"></label><label>מה הילד צריך לומר<input id="speechTarget" name="targetText" placeholder="למשל: ש"></label><label>תיאור / המשפט הכתוב (אופציונלי)<input id="speechPromptText" name="promptText" placeholder="למשל: שירה שותה שוקו"></label><label>תמונה<input id="speechImage" name="image" type="file" accept="image/*"></label><div id="speechImagePreview" class="mediaFilePreview hidden"><img alt="תצוגה מקדימה"></div><label>הקלטת המשפט<input id="speechPromptAudio" name="promptAudio" type="file" accept="audio/*"></label><div class="formActions"><button id="speechSaveBtn" type="submit">הוסף תרגיל</button><button id="speechCancelEdit" type="button" class="ghost hidden">בטל עריכה</button></div></form><div id="speechAdminStatus" class="muted"></div><div id="speechItemsList" class="speechItemsList"></div></div></details>`);
    $('#speechItemForm').onsubmit=saveItem;$('#speechCancelEdit').onclick=resetForm;
    $('#speechImage').onchange=()=>{const f=$('#speechImage').files?.[0],box=$('#speechImagePreview');if(!f?.size)return;box.querySelector('img').src=URL.createObjectURL(f);box.classList.remove('hidden');};
    $('#speechPracticeAdmin').addEventListener('toggle',()=>{if($('#speechPracticeAdmin').open)loadItems();});
  }
  async function loadItems(){
    const status=$('#speechAdminStatus');status.textContent='טוען…';
    try{const items=await api('/api/speech-items');status.textContent='';$('#speechItemsList').innerHTML=items.map(i=>`<article class="speechItemCard" data-id="${i.id}" data-title="${esc(i.title)}" data-target="${esc(i.target_text||i.targetText)}" data-prompt="${esc(i.prompt_text||i.promptText||'')}"><img src="${i.image}" alt=""><div><b>${esc(i.title)}</b><small>יעד: ${esc(i.target_text||i.targetText)}</small>${i.prompt_text||i.promptText?`<small>${esc(i.prompt_text||i.promptText)}</small>`:''}</div><div class="adminBtns"><button class="speechPlay ghost" type="button">🔊</button><button class="speechEdit ghost" type="button">✏️</button><button class="speechDelete danger" type="button">🗑️</button></div></article>`).join('')||'<div class="muted">עדיין אין תרגילי דיבור</div>';
      document.querySelectorAll('.speechItemCard').forEach(card=>{
        const item=items.find(i=>i.id===card.dataset.id);
        card.querySelector('.speechPlay').onclick=()=>new Audio(item.promptAudio).play().catch(()=>{});
        card.querySelector('.speechEdit').onclick=()=>startEdit(card,item);
        card.querySelector('.speechDelete').onclick=()=>deleteItem(item);
      });
    }catch(e){status.textContent=e.message==='internal_error'?'יש להחיל קודם את migration של תרגילי הדיבור ב־D1.':`שגיאה: ${e.message}`;}
  }
  function startEdit(card,item){editId=item.id;$('#speechTitle').value=item.title||'';$('#speechTarget').value=item.target_text||item.targetText||'';$('#speechPromptText').value=item.prompt_text||item.promptText||'';$('#speechImagePreview img').src=item.image;$('#speechImagePreview').classList.remove('hidden');$('#speechSaveBtn').textContent='שמור שינויים';$('#speechCancelEdit').classList.remove('hidden');}
  function resetForm(){editId=null;$('#speechItemForm').reset();$('#speechImagePreview').classList.add('hidden');$('#speechSaveBtn').textContent='הוסף תרגיל';$('#speechCancelEdit').classList.add('hidden');}
  async function saveItem(e){e.preventDefault();const fd=new FormData(e.currentTarget);const btn=$('#speechSaveBtn');btn.disabled=true;try{if(editId)await api(`/api/speech-items/${editId}`,{method:'PATCH',body:fd});else await api('/api/speech-items',{method:'POST',body:fd});resetForm();await loadItems();}catch(err){alert(err.message);}finally{btn.disabled=false;}}
  async function deleteItem(item){if(!confirm(`למחוק את ${item.title}?`))return;await api(`/api/speech-items/${item.id}`,{method:'DELETE'});await loadItems();}
  window.addEventListener('DOMContentLoaded',ensureUi);
})();
