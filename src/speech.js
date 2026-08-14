import { requireRole } from './auth.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const id=prefix=>`${prefix}_${crypto.randomUUID()}`;
const now=()=>new Date().toISOString();

const HEBREW_LETTER_NAMES={
  'א':['אלף'],'ב':['בית','בּית'],'ג':['גימל'],'ד':['דלת'],'ה':['הא'],'ו':['וו','ואו'],'ז':['זין'],'ח':['חית'],'ט':['טית'],'י':['יוד'],'כ':['כף'],'ך':['כף'],'ל':['למד'],'מ':['מם'],'ם':['מם'],'נ':['נון'],'ן':['נון'],'ס':['סמך'],'ע':['עין'],'פ':['פה'],'ף':['פה'],'צ':['צדי','צדיק'],'ץ':['צדי','צדיק'],'ק':['קוף'],'ר':['ריש'],'ש':['שין'],'ת':['תו']
};
const HEBREW_SOUND_VARIANTS={
  'א':['א','אה'],'ב':['ב','בה','בי','בו'],'ג':['ג','גה','גי','גו'],'ד':['ד','דה','די','דו'],'ה':['ה','הא'],'ו':['ו','וו','ואו'],'ז':['ז','זה','זי','זו'],'ח':['ח','חה','חי','חו'],'ט':['ט','טה','טי','טו'],'י':['י','יה','יי'],'כ':['כ','כה','כי','כו'],'ך':['כ','כה','כי','כו'],'ל':['ל','לה','לי','לו'],'מ':['מ','מה','מי','מו'],'ם':['מ','מה','מי','מו'],'נ':['נ','נה','ני','נו'],'ן':['נ','נה','ני','נו'],'ס':['ס','סה','סי','סו'],'ע':['ע','עה'],'פ':['פ','פה','פי','פו'],'ף':['פ','פה','פי','פו'],'צ':['צ','צה','צי','צו'],'ץ':['צ','צה','צי','צו'],'ק':['ק','קה','קי','קו'],'ר':['ר','רה','רי','רו'],'ש':['ש','שה','שי','שו'],'ת':['ת','תה','תי','תו']
};
function normalizeHebrew(text){
  return String(text||'').normalize('NFKD').replace(/[\u0591-\u05C7]/g,'').replace(/[^\u05D0-\u05EA]/g,'');
}
function evaluateTranscript(target,transcript){
  const t=normalizeHebrew(target),x=normalizeHebrew(transcript);
  if(!t)return {status:'pending',score:null,reason:'missing_target'};
  if(!x)return {status:'pending',score:null,reason:'no_transcript'};
  if(x===t||x.includes(t))return {status:'correct',score:1,reason:'direct_match'};
  if(t.length===1){
    const variants=[...(HEBREW_SOUND_VARIANTS[t]||[]),...(HEBREW_LETTER_NAMES[t]||[])].map(normalizeHebrew);
    if(variants.some(v=>v&&x.includes(v)))return {status:'correct',score:.9,reason:'phoneme_variant'};
    // Very short ASR output is too unreliable to call a child wrong on a single phoneme.
    if(x.length<=2)return {status:'pending',score:null,reason:'ambiguous_short_transcript'};
  }
  return {status:'wrong',score:0,reason:'different_transcript'};
}

async function transcribeAttempt(env,audio,target){
  if(!env.AI)return {status:'pending',transcript:'',score:null,evaluator:'workers_ai_missing',reason:'workers_ai_missing'};
  try{
    const bytes=[...new Uint8Array(await audio.arrayBuffer())];
    const result=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{
      audio:bytes,
      task:'transcribe',
      language:'he',
      vad_filter:false,
      initial_prompt:`הקלטה קצרה מאוד של ילד שחוזר על צליל של אות עברית אחת. האות הצפויה היא ${target}. ייתכן שהצליל יישמע כמו ${target}ה, ${target}י או ${target}ו. תמלל רק את הצליל שנשמע.`
    });
    const transcript=String(result?.text||'').trim();
    const evaluation=evaluateTranscript(target,transcript);
    return {...evaluation,transcript,evaluator:'workers_ai_whisper_large_v3_turbo'};
  }catch(e){
    console.error('speech evaluation failed',e);
    return {status:'pending',transcript:'',score:null,evaluator:'workers_ai_error',reason:'workers_ai_error'};
  }
}

async function serveSpeechMedia(env,url){
  const m=url.pathname.match(/^\/api\/speech-media\/([^/]+)\/(image|prompt)$/);
  if(!m)return null;
  const row=await env.DB.prepare(`SELECT image_key,prompt_audio_key,enabled FROM speech_items WHERE id=?`).bind(m[1]).first();
  if(!row||!row.enabled)return new Response('Not found',{status:404});
  const key=m[2]==='image'?row.image_key:row.prompt_audio_key;
  const obj=await env.MEDIA.get(key);
  if(!obj)return new Response('Not found',{status:404});
  const headers=new Headers();obj.writeHttpMetadata(headers);headers.set('etag',obj.httpEtag);headers.set('cache-control','private, no-cache');
  return new Response(obj.body,{headers});
}

export async function handleSpeechApi(request,env,url){
  const media=await serveSpeechMedia(env,url);if(media)return media;

  if(request.method==='GET'&&url.pathname==='/api/speech-items'){
    const rows=await env.DB.prepare(`SELECT id,title,target_text,prompt_text,enabled,created_at,updated_at FROM speech_items WHERE enabled=1 ORDER BY created_at DESC`).all();
    return json(rows.results.map(r=>({...r,image:`/api/speech-media/${r.id}/image?v=${encodeURIComponent(r.updated_at||r.created_at||'1')}`,promptAudio:`/api/speech-media/${r.id}/prompt?v=${encodeURIComponent(r.updated_at||r.created_at||'1')}`})));
  }

  if(request.method==='POST'&&url.pathname==='/api/speech-items'){
    const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;
    const form=await request.formData();
    const title=String(form.get('title')||'').trim(),targetText=String(form.get('targetText')||'').trim(),promptText=String(form.get('promptText')||'').trim();
    const image=form.get('image'),promptAudio=form.get('promptAudio');
    if(!title||!targetText||!(image instanceof File)||!image.size||!(promptAudio instanceof File)||!promptAudio.size)return json({error:'title_target_image_audio_required'},400);
    const itemId=id('speech'),base=`speech_items/${itemId}`,imageKey=`${base}/image`,audioKey=`${base}/prompt`;
    await Promise.all([
      env.MEDIA.put(imageKey,image.stream(),{httpMetadata:{contentType:image.type||'image/jpeg'}}),
      env.MEDIA.put(audioKey,promptAudio.stream(),{httpMetadata:{contentType:promptAudio.type||'audio/webm'}})
    ]);
    await env.DB.prepare(`INSERT INTO speech_items(id,title,target_text,prompt_text,image_key,prompt_audio_key) VALUES(?,?,?,?,?,?)`).bind(itemId,title,targetText,promptText,imageKey,audioKey).run();
    return json({id:itemId,title,targetText,promptText,image:`/api/speech-media/${itemId}/image`,promptAudio:`/api/speech-media/${itemId}/prompt`},201);
  }

  const itemMatch=url.pathname.match(/^\/api\/speech-items\/([^/]+)$/);
  if(itemMatch&&request.method==='PATCH'){
    const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;
    const row=await env.DB.prepare(`SELECT * FROM speech_items WHERE id=?`).bind(itemMatch[1]).first();if(!row)return json({error:'speech_item_not_found'},404);
    const form=await request.formData();
    const title=String(form.get('title')||row.title).trim(),targetText=String(form.get('targetText')||row.target_text).trim(),promptText=form.has('promptText')?String(form.get('promptText')||'').trim():row.prompt_text;
    const image=form.get('image'),promptAudio=form.get('promptAudio');
    if(image instanceof File&&image.size)await env.MEDIA.put(row.image_key,image.stream(),{httpMetadata:{contentType:image.type||'image/jpeg'}});
    if(promptAudio instanceof File&&promptAudio.size)await env.MEDIA.put(row.prompt_audio_key,promptAudio.stream(),{httpMetadata:{contentType:promptAudio.type||'audio/webm'}});
    await env.DB.prepare(`UPDATE speech_items SET title=?,target_text=?,prompt_text=?,updated_at=? WHERE id=?`).bind(title,targetText,promptText,now(),row.id).run();
    return json({ok:true,id:row.id});
  }

  if(itemMatch&&request.method==='DELETE'){
    const auth=await requireRole(request,env,['ADMIN']);if(auth.error)return auth.error;
    const row=await env.DB.prepare(`SELECT * FROM speech_items WHERE id=?`).bind(itemMatch[1]).first();if(!row)return json({error:'speech_item_not_found'},404);
    await Promise.all([env.MEDIA.delete(row.image_key),env.MEDIA.delete(row.prompt_audio_key)]);
    await env.DB.prepare(`UPDATE speech_items SET enabled=0,updated_at=? WHERE id=?`).bind(now(),row.id).run();
    return json({ok:true});
  }

  const attemptMatch=url.pathname.match(/^\/api\/speech-items\/([^/]+)\/attempts$/);
  if(attemptMatch&&request.method==='POST'){
    const form=await request.formData();
    const playerId=String(form.get('playerId')||''),attemptNo=Math.max(1,Number(form.get('attemptNo')||1)),audio=form.get('audio');
    if(!playerId||!(audio instanceof File)||!audio.size)return json({error:'player_and_audio_required'},400);
    const [player,item]=await Promise.all([
      env.DB.prepare(`SELECT id FROM players WHERE id=?`).bind(playerId).first(),
      env.DB.prepare(`SELECT id,target_text FROM speech_items WHERE id=? AND enabled=1`).bind(attemptMatch[1]).first()
    ]);
    if(!player)return json({error:'player_not_found'},404);if(!item)return json({error:'speech_item_not_found'},404);
    const attemptId=id('speech_attempt'),key=`speech_attempts/${playerId}/${item.id}/${attemptId}`;
    const evaluation=await transcribeAttempt(env,audio,item.target_text);
    await env.MEDIA.put(key,audio.stream(),{httpMetadata:{contentType:audio.type||'audio/webm'}});
    await env.DB.prepare(`INSERT INTO speech_attempts(id,player_id,item_id,attempt_no,response_audio_key,transcript,score,result,evaluator,evaluated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(attemptId,playerId,item.id,attemptNo,key,evaluation.transcript||null,evaluation.score,evaluation.status,evaluation.evaluator,evaluation.status==='pending'?null:now()).run();
    return json({attemptId,evaluation:{status:evaluation.status,targetText:item.target_text,transcript:evaluation.transcript,score:evaluation.score,evaluator:evaluation.evaluator,reason:evaluation.reason}},201);
  }

  return null;
}
