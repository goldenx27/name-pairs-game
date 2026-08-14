(() => {
  const $=s=>document.querySelector(s);
  const urls=new Map();

  function ensurePreview(input,id){
    if(!input)return null;
    let box=$(`#${id}`);
    if(!box){
      box=document.createElement('div');box.id=id;box.className='mediaFilePreview hidden';
      box.innerHTML='<img alt="תצוגה מקדימה">';
      input.insertAdjacentElement('afterend',box);
    }
    return box;
  }
  function showPreview(input,id,src){
    const box=ensurePreview(input,id);if(!box)return;
    const img=box.querySelector('img');img.src=src||'';box.classList.toggle('hidden',!src);
  }
  function previewFile(input,id){
    const old=urls.get(id);if(old)URL.revokeObjectURL(old);
    const file=input?.files?.[0];
    if(!file?.size){urls.delete(id);return;}
    const url=URL.createObjectURL(file);urls.set(id,url);showPreview(input,id,url);
  }
  function clearPreviews(){
    for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();
    ['image1Preview','image2Preview'].forEach(id=>document.getElementById(id)?.classList.add('hidden'));
  }
  function bind(){
    const i1=$('#image1'),i2=$('#image2');
    ensurePreview(i1,'image1Preview');ensurePreview(i2,'image2Preview');
    i1?.addEventListener('change',()=>previewFile(i1,'image1Preview'));
    i2?.addEventListener('change',()=>previewFile(i2,'image2Preview'));
    $('#characterForm')?.addEventListener('reset',()=>setTimeout(clearPreviews,0));
    $('#cancelEditBtn')?.addEventListener('click',()=>setTimeout(clearPreviews,0));
  }
  document.addEventListener('click',e=>{
    const btn=e.target.closest('.mediaEdit');if(!btn)return;
    const card=btn.closest('.crewAdminCard');if(!card)return;
    const imgs=card.querySelectorAll('.crewAdminImages img');
    setTimeout(()=>{
      showPreview($('#image1'),'image1Preview',imgs[0]?.src||'');
      showPreview($('#image2'),'image2Preview',imgs[1]?.src||'');
      const hint=$('#recordStatus');if(hint&&!hint.textContent)hint.textContent='בעריכה: שדות שלא תחליף יישארו ללא שינוי.';
    },0);
  },true);
  window.addEventListener('DOMContentLoaded',bind);
})();
