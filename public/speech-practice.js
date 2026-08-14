(() => {
  const $=s=>document.querySelector(s);
  let items=[], index=0, attemptNo=1, recorderCtl=null, running=false;

  function supported(){return !!(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder);}
  async function recordOnce({maxMs=3500,onStart,onStop}={}){
    if(!supported())throw new Error('recording_not_supported');
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    const chunks=[];const recorder=new MediaRecorder(stream);
    const done=new Promise((resolve,reject)=>{
      recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      recorder.onerror=e=>reject(e.error||new Error('recording_failed'));
      recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});onStop?.(blob);resolve(blob);};
    });
    recorder.start();onStart?.();
    const timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},maxMs);
    return {stop:()=>{clearTimeout(timer);if(recorder.state==='recording')recorder.stop();},done};
  }
  async function uploadAttempt({itemId,playerId,attemptNo=1,blob}){
    const fd=new FormData();fd.append('playerId',playerId);fd.append('attemptNo',String(attemptNo));fd.append('audio',new File([blob],'response.webm',{type:blob.type||'audio/webm'}));
    const r=await fetch(`/api/speech-items/${itemId}/attempts`,{method:'POST',body:fd});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'upload_failed');return d;
  }
  function playerId(){return localStorage.playerId||'';}
  function ensureUi(){
    if($('#letterPractice'))return;
    const game=$('#game');if(!game)return;
    game.insertAdjacentHTML('afterend',`<section id="letterPractice" class="card hidden"><div class="gameTop"><h2>🔤 תרגול אותיות</h2><button id="letterExit" class="ghost">חזרה</button></div><div id="letterStage" class="letterStage"></div></section>`);
    const crew=$('#crew');if(crew&&!$('#letterPracticeBtn'))crew.insertAdjacentHTML('beforebegin','<button id="letterPracticeBtn" class="primary letterPracticeBtn hidden">🔤 תרגול אותיות</button>');
    $('#letterExit').onclick=stopGame;
    $('#letterPracticeBtn').onclick=startGame;
    refreshAvailability();
  }
  async function refreshAvailability(){
    try{items=await fetch('/api/speech-items',{cache:'no-store'}).then(r=>r.ok?r.json():[]);$('#letterPracticeBtn')?.classList.toggle('hidden',!items.length||!playerId());}catch{}
  }
  async function startGame(){
    if(!playerId())return;
    if(!items.length)await refreshAvailability();if(!items.length)return;
    running=true;index=0;attemptNo=1;
    $('#game')?.classList.add('hidden');$('#crew')?.classList.add('hidden');$('#letterPracticeBtn')?.classList.add('hidden');$('#letterPractice')?.classList.remove('hidden');
    renderItem();
  }
  function stopGame(){
    running=false;recorderCtl?.stop?.();recorderCtl=null;
    $('#letterPractice')?.classList.add('hidden');$('#game')?.classList.remove('hidden');$('#crew')?.classList.remove('hidden');
    refreshAvailability();
  }
  function current(){return items[index%items.length];}
  function playPrompt(){const i=current();if(i)new Audio(i.promptAudio).play().catch(()=>{});}
  function renderItem(message=''){
    const i=current();if(!i)return stopGame();
    $('#letterStage').innerHTML=`<div class="letterPicture"><img src="${i.image}" alt=""></div><div class="letterTarget">הקשב ואז חזור רק על הצליל <strong>${i.target_text||i.targetText}</strong></div><div class="letterHint">כדאי לומר את הצליל ברור למשך כחצי שנייה.</div><div class="letterActions"><button id="letterListen" class="ghost">🔊 שמע שוב</button><button id="letterRecord" class="primary">🎤 הקלט</button></div><div id="letterStatus" class="letterStatus">${message}</div><div class="letterAttempts">ניסיון ${attemptNo} מתוך 3</div>`;
    $('#letterListen').onclick=playPrompt;$('#letterRecord').onclick=toggleRecord;
    setTimeout(playPrompt,250);
  }
  async function toggleRecord(){
    const btn=$('#letterRecord'),status=$('#letterStatus');
    if(recorderCtl){recorderCtl.stop();return;}
    try{
      recorderCtl=await recordOnce({onStart:()=>{btn.textContent='⏹️ סיים';status.textContent='מקליט… אמור רק את הצליל';}});
      const blob=await recorderCtl.done;recorderCtl=null;btn.textContent='🎤 הקלט';status.textContent='בודק את ההקלטה…';
      const result=await uploadAttempt({itemId:current().id,playerId:playerId(),attemptNo,blob});
      const ev=result.evaluation||{};
      if(ev.status==='correct'){
        const heard=ev.transcript?` שמעתי: „${ev.transcript}”` : '';
        status.textContent=`🎉 מצוין!${heard}`;
        return setTimeout(nextItem,1100);
      }
      if(ev.status==='wrong'){
        const heard=ev.transcript?`שמעתי: „${ev.transcript}”. `:'';
        if(attemptNo<3){attemptNo++;renderItem(`${heard}ננסה שוב — הקשב לצליל וחזור רק עליו`);}
        else{status.textContent=`${heard}ממשיכים לתרגיל הבא`;setTimeout(nextItem,1200);}
        return;
      }
      const heard=ev.transcript?`שמעתי משהו שנשמע כמו „${ev.transcript}”, אבל אני לא בטוחה.`:'לא הצלחתי לזהות את הצליל בוודאות.';
      status.innerHTML=`${heard}<div class="letterManual"><button id="letterAgain" class="ghost">🔁 הקלט שוב</button><button id="letterNext" class="primary">הבא</button></div>`;
      $('#letterAgain').onclick=()=>{if(attemptNo<3)attemptNo++;renderItem('נסה לומר את הצליל קצת יותר ברור וארוך');};
      $('#letterNext').onclick=()=>nextItem();
    }catch(e){recorderCtl=null;if(btn)btn.textContent='🎤 הקלט';if(status)status.textContent=e.message==='recording_not_supported'?'המכשיר לא תומך בהקלטה':'לא הצלחתי להקליט. נסה שוב.';}
  }
  function nextItem(){attemptNo=1;index=(index+1)%items.length;renderItem();}
  document.addEventListener('click',e=>{if(running&&e.target.closest?.('#modeBtn'))stopGame();},true);
  window.SpeechPractice={supported,recordOnce,uploadAttempt,startGame,refreshAvailability};
  window.addEventListener('DOMContentLoaded',ensureUi);
})();
