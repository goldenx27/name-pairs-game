(() => {
  function supported(){return !!(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder);}
  async function recordOnce({maxMs=5000,onStart,onStop}={}){
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
  window.SpeechPractice={supported,recordOnce,uploadAttempt};
})();
