(()=>{
const HOUSE_NAMES=['אבי',"אפצ'י",'אפריים','אפרת','אילנית','אורן','אורים קטנים','סבתא שלומית','אורי'];
const norm=s=>String(s||'').trim().replaceAll('׳',"'");
const houseSvg=name=>`<svg viewBox="0 0 180 150" role="img" aria-label="הבית של ${name}"><path d="M12 63 L90 10 L168 63 L151 64 L151 140 L29 140 L29 64 Z" fill="#fffaf0" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><rect x="76" y="101" width="28" height="39" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="76" cy="82" r="6"/><circle cx="104" cy="82" r="6"/></svg>`;
function shuffle(a){return [...a].sort(()=>Math.random()-.5)}
function injectButton(){const p=document.querySelector('#gameModePicker');if(!p||p.querySelector('[data-mode="house_pairs"]'))return;const b=document.createElement('button');b.type='button';b.dataset.mode='house_pairs';b.textContent='🏠 למי הבית?';p.appendChild(b);b.onclick=()=>start();}
async function start(){
 const snap=window.__housePairsSnapshot||await fetch(`/api/players/${localStorage.playerId}/state`).then(r=>r.json());
 const chars=(snap.characters||[]).filter(c=>c.status!=='hidden'&&HOUSE_NAMES.includes(norm(c.name)));
 const stage=document.querySelector('#gameStage'),prompt=document.querySelector('#prompt'),feedback=document.querySelector('#feedback');
 if(!stage)return;if(chars.length<2){prompt.textContent='צריך לפחות שתי דמויות למשחק הבתים 🏠';stage.innerHTML='';return;}
 prompt.textContent='חברו כל דמות לבית שלה 🏠';feedback.textContent='';document.querySelector('#nextBtn')?.classList.add('hidden');
 const chosen=shuffle(chars).slice(0,Math.min(4,chars.length)), houses=shuffle(chosen);
 stage.innerHTML=`<div class="housePairsBoard"><svg class="housePairLines"></svg><div class="houseCharacters">${chosen.map(c=>`<button class="houseCharacter" data-id="${c.id}" data-name="${norm(c.name)}"><img src="${c.image1}" alt="${c.name}"><span>${c.name}</span><i></i></button>`).join('')}</div><div class="houseTargets">${houses.map(c=>`<button class="houseTarget" data-id="${c.id}" data-name="${norm(c.name)}">${houseSvg(norm(c.name))}<span>${c.name}</span><i></i></button>`).join('')}</div></div>`;
 let selected=null,matched=0;const board=stage.querySelector('.housePairsBoard');
 const draw=()=>{const svg=board.querySelector('.housePairLines'),br=board.getBoundingClientRect();svg.innerHTML='';board.querySelectorAll('.houseCharacter.matched').forEach(a=>{const b=board.querySelector(`.houseTarget[data-id="${a.dataset.id}"]`);if(!b)return;const ar=a.querySelector('i').getBoundingClientRect(),rr=b.querySelector('i').getBoundingClientRect();const x1=ar.left+ar.width/2-br.left,y1=ar.top+ar.height/2-br.top,x2=rr.left+rr.width/2-br.left,y2=rr.top+rr.height/2-br.top;svg.insertAdjacentHTML('beforeend',`<path d="M${x1} ${y1} C${x1+70} ${y1},${x2-70} ${y2},${x2} ${y2}"/>`)});};
 board.querySelectorAll('.houseCharacter').forEach(a=>a.onclick=()=>{if(a.classList.contains('matched'))return;board.querySelectorAll('.houseCharacter').forEach(x=>x.classList.remove('selected'));a.classList.add('selected');selected=a;});
 board.querySelectorAll('.houseTarget').forEach(b=>b.onclick=()=>{if(!selected||b.classList.contains('matched'))return;if(selected.dataset.id===b.dataset.id){selected.classList.remove('selected');selected.classList.add('matched');b.classList.add('matched');matched++;feedback.textContent='✨ נכון!';selected=null;draw();if(matched===chosen.length){feedback.textContent='🎉 מצאתם את כל הבתים!';document.querySelector('#nextBtn')?.classList.remove('hidden');}}else{b.classList.add('wrong');feedback.textContent='🙂 נסו בית אחר';setTimeout(()=>b.classList.remove('wrong'),450);}});
 addEventListener('resize',draw,{once:false});
}
window.startHousePairs=start;
const oldFetch=window.fetch;window.fetch=async(...args)=>{const r=await oldFetch(...args);try{if(String(args[0]).includes('/state'))window.__housePairsSnapshot=await r.clone().json()}catch{}return r};
new MutationObserver(injectButton).observe(document.documentElement,{childList:true,subtree:true});injectButton();
})();