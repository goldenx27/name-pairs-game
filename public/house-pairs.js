(()=>{
const HOUSE_MARKS={
  'אבי':'ַ',
  "אפצ'י":'ָ',
  'אפרת':'ֵ',
  'אפריים':'ֶ',
  'אילנית':'ִ',
  'אורים קטנים':'ֻ',
  'אורי':'וּ',
  'סבתא שלומית':'ְ'
};
const norm=s=>String(s||'').trim().replaceAll('׳',"'");
const shuffle=a=>[...a].sort(()=>Math.random()-.5);
const esc=s=>String(s||'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function markFor(name){return HOUSE_MARKS[norm(name)]||null;}

function houseCard(name){
  const n=norm(name),mark=markFor(n),shuruk=n==='אורי';
  return `<div class="niqqudHouse" aria-label="הבית של ${esc(n)}">
    <div class="niqqudRoof"></div>
    <div class="niqqudBody"></div>
    <div class="niqqudDoor"></div>
    <div class="niqqudBush left"></div><div class="niqqudBush right"></div>
    <div class="niqqudMark ${shuruk?'shuruk':''}">${mark}</div>
  </div>`;
}

function injectStyles(){if(document.querySelector('#niqqudHouseStyles'))return;const s=document.createElement('style');s.id='niqqudHouseStyles';s.textContent=`
#gameStage:has(.housePairsBoard){height:auto!important;min-height:360px!important;max-height:none!important;overflow:visible!important;align-items:stretch!important}
.housePairsBoard{position:relative;width:100%;display:grid;grid-template-columns:1fr 1fr;gap:62px;padding:6px 16px 16px;box-sizing:border-box}.houseCharacters,.houseTargets{display:grid;gap:10px;position:relative;z-index:2}.houseCharacter,.houseTarget{position:relative;min-height:120px;padding:6px;border:3px solid transparent;border-radius:20px;background:#f7f7fb;color:#222;touch-action:none;overflow:visible}.houseCharacter img{width:100%;height:106px;object-fit:cover;border-radius:14px;display:block}.houseCharacter span{display:block;font-weight:700;margin-top:4px}.houseCharacter.selected{border-color:#6d5dfc}.houseCharacter.matched,.houseTarget.matched{border-color:#34a853;box-shadow:0 0 0 3px #34a85322;pointer-events:none}.houseTarget.wrong{border-color:#ea4335}.houseCharacter i,.houseTarget i{position:absolute;top:50%;width:15px;height:15px;border:4px solid #6d5dfc;background:#fff;border-radius:50%;transform:translateY(-50%);z-index:4}.houseCharacter i{left:-12px}.houseTarget i{right:-12px}.housePairLines{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none}.housePairLines path{fill:none;stroke:#34a853;stroke-width:7;stroke-linecap:round}
.niqqudHouse{height:108px;width:100%;position:relative;display:grid;place-items:center}.niqqudRoof{position:absolute;top:0;left:11%;right:11%;height:36px;background:#ff4d3f;clip-path:polygon(50% 0,100% 100%,0 100%);filter:drop-shadow(0 2px 0 #202124)}.niqqudBody{position:absolute;top:34px;left:20%;right:20%;bottom:5px;background:#fff;border:4px solid #202124;border-top-width:3px;border-radius:3px}.niqqudDoor{position:absolute;bottom:5px;left:50%;transform:translateX(-50%);width:24px;height:29px;background:#f1c675;border:3px solid #202124;border-radius:4px 4px 0 0;z-index:2}.niqqudBush{position:absolute;bottom:1px;width:31px;height:15px;background:#66b937;border-radius:50% 50% 28% 28%;z-index:1}.niqqudBush.left{left:8%}.niqqudBush.right{right:8%}.niqqudMark{position:relative;z-index:3;color:#111;font-family:'Noto Sans Hebrew','Arial Hebrew',Arial,sans-serif;font-size:58px;font-weight:700;line-height:1;direction:rtl;unicode-bidi:isolate;transform:translateY(7px)}.niqqudMark.shuruk{font-size:50px;transform:translateY(4px)}
@media(max-width:500px){.housePairsBoard{gap:44px;padding:4px 10px 14px}.houseCharacter,.houseTarget{min-height:108px}.houseCharacter img{height:94px}.niqqudHouse{height:96px}.niqqudMark{font-size:52px}.niqqudMark.shuruk{font-size:46px}.housePairLines path{stroke-width:6px}}
`;document.head.appendChild(s);}

function injectButton(){const p=document.querySelector('#gameModePicker');if(!p||p.querySelector('[data-mode="house_pairs"]'))return;const b=document.createElement('button');b.type='button';b.dataset.mode='house_pairs';b.textContent='🏠 למי הבית?';p.appendChild(b);b.onclick=e=>{e.preventDefault();e.stopPropagation();start();};}

async function start(){
 const pid=localStorage.playerId;if(!pid)return;
 localStorage.gameMode='house_pairs';
 document.querySelectorAll('#gameModePicker button').forEach(x=>x.classList.toggle('selected',x.dataset.mode==='house_pairs'));
 const snap=window.__housePairsSnapshot||await fetch(`/api/players/${pid}/state`,{cache:'no-store'}).then(r=>r.json());
 const chars=(snap.characters||[]).filter(c=>c.status!=='hidden'&&markFor(c.name));
 const stage=document.querySelector('#gameStage'),prompt=document.querySelector('#prompt'),feedback=document.querySelector('#feedback');
 if(!stage)return;
 if(chars.length<2){prompt.textContent='צריך לפחות שתי דמויות למשחק הבתים 🏠';stage.innerHTML='';feedback.textContent='';return;}
 prompt.textContent='חברו כל דמות לבית שלה 🏠';feedback.textContent='';document.querySelector('#nextBtn')?.classList.add('hidden');document.querySelector('#playAgain')?.classList.add('hidden');
 const chosen=shuffle(chars).slice(0,Math.min(4,chars.length)),houses=shuffle(chosen);
 stage.innerHTML=`<div class="housePairsBoard"><svg class="housePairLines"></svg><div class="houseCharacters">${chosen.map(c=>`<button class="houseCharacter" data-id="${c.id}" data-name="${esc(norm(c.name))}"><img src="${c.image1}" alt="${esc(c.name)}"><span>${esc(c.name)}</span><i></i></button>`).join('')}</div><div class="houseTargets">${houses.map(c=>`<button class="houseTarget" data-id="${c.id}" data-name="${esc(norm(c.name))}">${houseCard(c.name)}<i></i></button>`).join('')}</div></div>`;
 let selected=null,matched=0;const board=stage.querySelector('.housePairsBoard');
 const draw=()=>{const svg=board.querySelector('.housePairLines'),br=board.getBoundingClientRect();svg.innerHTML='';board.querySelectorAll('.houseCharacter.matched').forEach(a=>{const b=board.querySelector(`.houseTarget[data-id="${CSS.escape(a.dataset.id)}"]`);if(!b)return;const ar=a.querySelector('i').getBoundingClientRect(),rr=b.querySelector('i').getBoundingClientRect();const x1=ar.left+ar.width/2-br.left,y1=ar.top+ar.height/2-br.top,x2=rr.left+rr.width/2-br.left,y2=rr.top+rr.height/2-br.top;svg.insertAdjacentHTML('beforeend',`<path d="M${x1} ${y1} C${x1+70} ${y1},${x2-70} ${y2},${x2} ${y2}"/>`)});};
 board.querySelectorAll('.houseCharacter').forEach(a=>a.onclick=()=>{if(a.classList.contains('matched'))return;board.querySelectorAll('.houseCharacter').forEach(x=>x.classList.remove('selected'));a.classList.add('selected');selected=a;});
 board.querySelectorAll('.houseTarget').forEach(b=>b.onclick=async()=>{if(!selected||b.classList.contains('matched'))return;if(selected.dataset.id===b.dataset.id){const charId=selected.dataset.id;selected.classList.remove('selected');selected.classList.add('matched');b.classList.add('matched');matched++;feedback.textContent='✨ נכון!';selected=null;draw();try{await fetch('/api/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerId:pid,eventType:'house_pair_match',characterId:charId,selectedCharacterId:charId,result:'correct'})});}catch{}if(matched===chosen.length){feedback.textContent='🎉 מצאתם את כל הבתים!';const next=document.querySelector('#nextBtn');if(next){next.classList.remove('hidden');next.onclick=()=>start();}}}else{b.classList.add('wrong');feedback.textContent='🙂 נסו בית אחר';setTimeout(()=>b.classList.remove('wrong'),450);}});
 addEventListener('resize',draw,{passive:true});
}
window.startHousePairs=start;
const oldFetch=window.fetch;window.fetch=async(...args)=>{const r=await oldFetch(...args);try{if(String(args[0]).includes('/state'))window.__housePairsSnapshot=await r.clone().json()}catch{}return r};
function init(){injectStyles();injectButton();if(localStorage.gameMode==='house_pairs')setTimeout(start,350)}
new MutationObserver(injectButton).observe(document.documentElement,{childList:true,subtree:true});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();