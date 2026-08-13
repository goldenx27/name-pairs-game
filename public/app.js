const $ = s => document.querySelector(s);
const state = {
  familyId: localStorage.familyId,
  playerId: localStorage.playerId,
  current: null,
  sessionId: null,
  parentPin: null,
  snapshot: null,
  editId: null,
  pairOpen: [],
  pairLocked: false,
  pairMatched: new Set()
};

const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'request_failed');
  return d;
}

async function init() {
  if (!state.familyId || !state.playerId) {
    show('#setup');
    return;
  }
  show('#game');
  show('#crew');
  await refresh();
  await nextRound();
}

async function refresh() {
  state.snapshot = await api(`/api/players/${state.playerId}/state`);
  renderCrew(state.snapshot.characters);
  return state.snapshot;
}

function renderCrew(chars) {
  const revealed = chars.filter(c => c.status !== 'hidden');
  $('#crewProgress').textContent = `${revealed.length}/${chars.length}`;
  $('#crewGrid').innerHTML = chars.map(c => {
    if (c.status === 'hidden') return `<div class="mystery" title="עוד לא הצטרף">❓</div>`;
    return `<div class="person" data-id="${c.id}"><img src="${c.image1}" alt=""><span>${c.name}</span></div>`;
  }).join('');
  document.querySelectorAll('.person').forEach(el => {
    el.onclick = () => {
      const c = chars.find(x => x.id === el.dataset.id);
      new Audio(c.audio).play();
    };
  });
}

async function ensureSession() {
  if (!state.sessionId) {
    const d = await api('/api/session/start', {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({playerId: state.playerId, gameType:'mixed'})
    });
    state.sessionId = d.sessionId;
  }
}

async function nextRound() {
  await ensureSession();
  show('#nextBtn', false);
  show('#playAgain', false);
  $('#feedback').textContent = '';
  $('#gameStage').innerHTML = '';
  const d = await api(`/api/game/next?playerId=${state.playerId}`);
  state.current = d;
  state.pairOpen = [];
  state.pairLocked = false;
  state.pairMatched = new Set();

  if (d.type === 'waiting_for_characters') {
    $('#prompt').textContent = 'החבורה עוד מתארגנת 🙂';
    return;
  }
  if (d.type === 'find_character') return renderFind(d);
  if (d.type === 'who_is_it') return renderWho(d);
  if (d.type === 'pairs') return renderPairs(d);
}

function renderFind(d) {
  $('#prompt').textContent = `איפה ${d.target.name}?`;
  show('#playAgain');
  new Audio(d.target.audio).play();
  $('#gameStage').innerHTML = `<div id="choices" class="choices"></div>`;
  $('#choices').innerHTML = d.options.map(c => {
    const slot = c.id === d.target.id ? d.imageSlot : (Math.random() < .5 ? 1 : 2);
    return `<button class="choice" data-id="${c.id}" data-slot="${slot}"><img src="${slot===1?c.image1:c.image2}" alt=""></button>`;
  }).join('');
  document.querySelectorAll('.choice').forEach(b => b.onclick = () => chooseFind(b));
}

async function chooseFind(btn) {
  if (btn.disabled) return;
  document.querySelectorAll('.choice').forEach(x => x.disabled = true);
  const ok = btn.dataset.id === state.current.target.id;
  btn.classList.add(ok ? 'good' : 'bad');
  $('#feedback').textContent = ok ? '🎉✨' : '🙂 כמעט!';
  const res = await postResult({
    eventType:'find_character', characterId:state.current.target.id,
    selectedCharacterId:btn.dataset.id, imageSlot:Number(state.current.imageSlot), result:ok?'correct':'wrong'
  });
  await afterResult(res);
}

function renderWho(d) {
  $('#prompt').textContent = 'מי זה? 👀';
  const image = d.imageSlot === 1 ? d.target.image1 : d.target.image2;
  $('#gameStage').innerHTML = `
    <div class="whoCard"><img src="${image}" alt=""></div>
    <div class="audioChoices">${d.options.map(c => `<button class="audioChoice" data-id="${c.id}">🔊</button>`).join('')}</div>`;
  document.querySelectorAll('.audioChoice').forEach(b => b.onclick = () => chooseWho(b));
}

async function chooseWho(btn) {
  if (btn.disabled) return;
  const option = state.current.options.find(c => c.id === btn.dataset.id);
  await new Audio(option.audio).play().catch(()=>{});
  document.querySelectorAll('.audioChoice').forEach(x => x.disabled = true);
  const ok = option.id === state.current.target.id;
  btn.classList.add(ok ? 'good' : 'bad');
  $('#feedback').textContent = ok ? `🎉 ${state.current.target.name}!` : '🙂 ננסה שוב בהמשך';
  const res = await postResult({
    eventType:'who_is_it', characterId:state.current.target.id,
    selectedCharacterId:option.id, imageSlot:Number(state.current.imageSlot), result:ok?'correct':'wrong'
  });
  await afterResult(res);
}

function renderPairs(d) {
  $('#prompt').textContent = 'מצא את הזוגות 🎴';
  $('#gameStage').innerHTML = `<div class="memoryGrid">${d.cards.map(c => `
    <button class="memoryCard" data-card="${c.cardId}" data-char="${c.characterId}" data-slot="${c.imageSlot}">
      <img src="${c.image}" alt="">
    </button>`).join('')}</div>`;
  document.querySelectorAll('.memoryCard').forEach(b => b.onclick = () => flipCard(b));
}

async function flipCard(btn) {
  if (state.pairLocked || btn.classList.contains('matched') || btn.classList.contains('revealed')) return;
  btn.classList.add('revealed');
  const card = state.current.cards.find(c => c.cardId === btn.dataset.card);
  new Audio(card.audio).play();
  state.pairOpen.push(btn);
  if (state.pairOpen.length < 2) return;

  state.pairLocked = true;
  const [a,b] = state.pairOpen;
  if (a.dataset.char === b.dataset.char) {
    a.classList.add('matched'); b.classList.add('matched');
    state.pairMatched.add(a.dataset.char);
    const matchedCard = state.current.cards.find(c => c.characterId === a.dataset.char);
    const res = await postResult({
      eventType:'pair_match', characterId:a.dataset.char,
      selectedCharacterId:a.dataset.char, imageSlot:Number(matchedCard.imageSlot), result:'correct'
    });
    if (res.unlocked) $('#feedback').textContent = `🎁 ${res.unlocked.name} הצטרף/ה לחבורה!`;
    state.pairOpen = [];
    state.pairLocked = false;
    await refresh();
    const totalPairs = new Set(state.current.cards.map(c=>c.characterId)).size;
    if (state.pairMatched.size === totalPairs) {
      $('#feedback').textContent = $('#feedback').textContent || '🎉 מצאת את כולם!';
      show('#nextBtn');
    }
  } else {
    setTimeout(() => {
      a.classList.remove('revealed'); b.classList.remove('revealed');
      state.pairOpen = [];
      state.pairLocked = false;
    }, 700);
  }
}

async function postResult(payload) {
  return api('/api/events', {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({sessionId:state.sessionId, playerId:state.playerId, ...payload})
  });
}

async function afterResult(res) {
  if (res.unlocked) $('#feedback').textContent = `🎁 ${res.unlocked.name} הצטרף/ה לחבורה!`;
  await refresh();
  show('#nextBtn');
}

$('#playAgain').onclick = () => state.current?.target && new Audio(state.current.target.audio).play();
$('#nextBtn').onclick = nextRound;

$('#bootstrapBtn').onclick = async () => {
  const pin = $('#newPin').value.trim();
  if (!/^\d{4,6}$/.test(pin)) return alert('בחר קוד הורה בן 4–6 ספרות');
  const d = await api('/api/bootstrap', {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({pin})
  });
  localStorage.familyId = d.familyId;
  localStorage.playerId = d.playerId;
  location.reload();
};

function openPinModal(mode) {
  $('#pinError').textContent = '';
  $('#parentPinInput').value = '';
  $('#pinModal').dataset.mode = mode;
  if (mode === 'set') {
    $('#pinTitle').textContent = 'קבע קוד הורה';
    $('#pinText').textContent = 'בחר 4–6 ספרות. הקוד יידרש בכל כניסה לאזור ההורה.';
  } else {
    $('#pinTitle').textContent = 'קוד הורה';
    $('#pinText').textContent = 'הקלד את הקוד כדי להיכנס.';
  }
  show('#pinModal');
  $('#parentPinInput').focus();
}

$('#modeBtn').onclick = async () => {
  const snap = await refresh();
  openPinModal(snap.hasParentPin ? 'verify' : 'set');
};
$('#pinCancelBtn').onclick = () => show('#pinModal', false);
$('#pinConfirmBtn').onclick = async () => {
  const pin = $('#parentPinInput').value.trim();
  try {
    const mode = $('#pinModal').dataset.mode;
    if (mode === 'set') {
      await api('/api/parent/pin', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({familyId:state.familyId,pin})
      });
    } else {
      await api('/api/parent/verify', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({familyId:state.familyId,pin})
      });
    }
    state.parentPin = pin;
    show('#pinModal', false);
    await openParent();
  } catch (e) {
    $('#pinError').textContent = e.message === 'wrong_pin' ? 'קוד שגוי' : 'לא ניתן לאשר את הקוד';
  }
};

async function openParent() {
  show('#parent'); show('#game',false); show('#crew',false);
  $('#modeBtn').textContent = '🔓 אזור הורה';
  await loadAdmin();
}
function closeParent() {
  show('#parent',false); show('#game'); show('#crew');
  $('#modeBtn').textContent = '🔒 אזור הורה';
  state.parentPin = null;
  resetEditForm();
}
$('#closeParent').onclick = closeParent;

async function loadAdmin() {
  const chars = await api('/api/characters');
  $('#adminList').innerHTML = chars.map(c => `
    <div class="adminItem" data-id="${c.id}">
      <img src="${c.image1}" alt=""><b>${c.name}</b>
      <div class="adminBtns"><button class="editBtn ghost">✏️ ערוך</button><button class="deleteBtn danger">🗑️ מחק</button></div>
    </div>`).join('');
  document.querySelectorAll('.adminItem').forEach(el => {
    const c = chars.find(x => x.id === el.dataset.id);
    el.querySelector('.editBtn').onclick = () => startEdit(c);
    el.querySelector('.deleteBtn').onclick = () => deleteCharacter(c);
  });
}

function startEdit(c) {
  state.editId = c.id;
  $('#editCharacterId').value = c.id;
  $('#characterName').value = c.name;
  $('#saveCharacterBtn').textContent = 'שמור שינויים';
  show('#cancelEditBtn');
  $('#image1').required = false; $('#image2').required = false; $('#audioFile').required = false;
  window.scrollTo({top:0,behavior:'smooth'});
}
function resetEditForm() {
  state.editId = null;
  $('#characterForm').reset();
  $('#editCharacterId').value = '';
  $('#saveCharacterBtn').textContent = 'הוסף לחבורה';
  show('#cancelEditBtn',false);
  $('#image1').required = true; $('#image2').required = true; $('#audioFile').required = true;
  $('#recordStatus').textContent = '';
}
$('#cancelEditBtn').onclick = resetEditForm;

async function deleteCharacter(c) {
  if (!confirm(`למחוק את ${c.name} מהמאגר הגלובלי?`)) return;
  await api(`/api/characters/${c.id}`, {
    method:'DELETE', headers:{'content-type':'application/json'},
    body:JSON.stringify({familyId:state.familyId,parentPin:state.parentPin})
  });
  await loadAdmin(); await refresh();
}

let recorder, chunks=[];
$('#recordBtn').onclick = async () => {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  const stream = await navigator.mediaDevices.getUserMedia({audio:true});
  chunks=[]; recorder=new MediaRecorder(stream);
  recorder.ondataavailable=e=>chunks.push(e.data);
  recorder.onstop=()=>{
    const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
    const file=new File([blob],'recording.webm',{type:blob.type});
    const dt=new DataTransfer();dt.items.add(file);$('#audioFile').files=dt.files;
    $('#recordStatus').textContent='ההקלטה מוכנה ✅';$('#recordBtn').textContent='🎙️ הקלט שוב';
    stream.getTracks().forEach(t=>t.stop());
  };
  recorder.start();$('#recordStatus').textContent='מקליט...';$('#recordBtn').textContent='⏹️ עצור';
};

$('#characterForm').onsubmit = async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  fd.append('familyId',state.familyId);
  fd.append('parentPin',state.parentPin);
  const btn = $('#saveCharacterBtn'); btn.disabled=true;
  try {
    if (state.editId) {
      await api(`/api/characters/${state.editId}`, {method:'PATCH',body:fd});
    } else {
      const files = ['image1','image2','audio'].map(n => fd.get(n));
      if (files.some(f => !(f instanceof File) || f.size===0)) throw new Error('צריך שתי תמונות וקול');
      await api('/api/characters',{method:'POST',body:fd});
    }
    resetEditForm();
    await loadAdmin(); await refresh();
  } catch (e) { alert(e.message); }
  finally { btn.disabled=false; }
};

$('#resetProgressBtn').onclick = async () => {
  if (!confirm('לאפס את כל ההתקדמות ולהתחיל שוב משתי הדמויות הראשונות? הדמויות עצמן לא יימחקו.')) return;
  await api(`/api/players/${state.playerId}/reset`, {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({familyId:state.familyId,parentPin:state.parentPin})
  });
  state.sessionId = null;
  await refresh();
  closeParent();
  await nextRound();
};

init().catch(e => { console.error(e); alert(e.message); });
