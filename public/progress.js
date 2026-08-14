(() => {
  const $ = (s) => document.querySelector(s);
  let selectedPlayerId = null;

  const pct = (ok, bad) => {
    const n = Number(ok || 0) + Number(bad || 0);
    return n ? Math.round((Number(ok || 0) / n) * 100) : null;
  };

  const classify = (c) => {
    const attempts = Number(c.correct_count || 0) + Number(c.wrong_count || 0);
    const accuracy = pct(c.correct_count, c.wrong_count);
    const p1 = pct(c.image1_correct, c.image1_wrong);
    const p2 = pct(c.image2_correct, c.image2_wrong);
    const seenImageScores = [p1, p2].filter(v => v !== null);
    const weakestImage = seenImageScores.length ? Math.min(...seenImageScores) : null;
    if (c.status === 'hidden') return { key:'hidden', label:'עוד לא נחשף', icon:'🔒', mastery:0 };
    if (attempts < 2) return { key:'new', label:'חדש', icon:'🌱', mastery:Math.min(25, attempts * 12) };
    if (attempts >= 4 && accuracy >= 85 && (weakestImage === null || weakestImage >= 70)) return { key:'mastered', label:'שולט', icon:'⭐', mastery:Math.min(100, accuracy) };
    if (accuracy < 60 || (weakestImage !== null && weakestImage < 50)) return { key:'hard', label:'צריך חיזוק', icon:'🎯', mastery:Math.max(20, accuracy || 0) };
    return { key:'learning', label:'מתקדם', icon:'🚀', mastery:Math.max(35, accuracy || 0) };
  };

  const imageLine = (label, ok, bad) => {
    const score = pct(ok, bad), tries = Number(ok || 0) + Number(bad || 0);
    return tries ? `<span>${label}: ${score}% (${tries})</span>` : `<span>${label}: עוד לא נבדקה</span>`;
  };

  function clearProgress() {
    selectedPlayerId = null;
    const panel = $('#progressPanel');
    if (panel) panel.innerHTML = '';
  }

  async function renderProgress(playerId = selectedPlayerId, childName = '') {
    const panel = $('#progressPanel');
    if (!panel || !playerId) { clearProgress(); return; }
    selectedPlayerId = playerId;
    panel.innerHTML = '<div class="progressLoading">טוען התקדמות…</div>';
    try {
      const r = await fetch(`/api/manage/children/${encodeURIComponent(playerId)}/progress`, {credentials:'same-origin'});
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'request_failed');
      const chars = data.characters || [], visible = chars.filter(c => c.status !== 'hidden');
      const enriched = visible.map(c => ({c, level:classify(c)}));
      const mastered = enriched.filter(x => x.level.key === 'mastered').length;
      const hard = enriched.filter(x => x.level.key === 'hard').length;
      const totalCorrect = visible.reduce((s,c)=>s+Number(c.correct_count||0),0);
      const totalWrong = visible.reduce((s,c)=>s+Number(c.wrong_count||0),0);
      const totalAttempts = totalCorrect + totalWrong;
      const overall = totalAttempts ? Math.round(totalCorrect / totalAttempts * 100) : 0;
      const focus = enriched.filter(x=>x.level.key!=='mastered').sort((a,b)=>(pct(a.c.correct_count,a.c.wrong_count)??-1)-(pct(b.c.correct_count,b.c.wrong_count)??-1)).slice(0,3);
      panel.innerHTML = `
        <div class="progressTitleRow"><div><h3>📈 התקדמות${childName ? ` — ${childName}` : ''}</h3><p>מה כבר חזק ואיפה כדאי להתמקד</p></div><button id="closeProgressBtn" type="button" class="ghost">✕ סגור</button></div>
        <div class="progressSummary"><div><b>${visible.length}/${chars.length}</b><span>נחשפו</span></div><div><b>${mastered}</b><span>שולט</span></div><div><b>${hard}</b><span>צריך חיזוק</span></div><div><b>${totalAttempts ? overall+'%' : '—'}</b><span>הצלחה כוללת</span></div></div>
        ${focus.length ? `<div class="focusBox"><b>🎯 במה להתמקד עכשיו</b><div>${focus.map(x=>`<span>${x.c.name}</span>`).join('')}</div></div>` : visible.length ? '<div class="focusBox successFocus">⭐ כרגע אין דמות שבולטת כקושי</div>' : ''}
        <div class="characterProgressList">${enriched.map(({c,level})=>{const attempts=Number(c.correct_count||0)+Number(c.wrong_count||0),accuracy=pct(c.correct_count,c.wrong_count);return `<div class="characterProgress ${level.key}"><img src="${c.image1}" alt="${c.name}"><div class="characterProgressBody"><div class="characterProgressHead"><b>${c.name}</b><span>${level.icon} ${level.label}</span></div><div class="masteryTrack"><i style="width:${level.mastery}%"></i></div><div class="characterStats"><span>${attempts?`${accuracy}% הצלחה · ${attempts} ניסיונות`:'עדיין אין מספיק מידע'}</span>${imageLine('תמונה 1',c.image1_correct,c.image1_wrong)}${imageLine('תמונה 2',c.image2_correct,c.image2_wrong)}</div></div></div>`;}).join('') || '<p class="muted">עדיין אין נתוני משחק.</p>'}</div>`;
      $('#closeProgressBtn')?.addEventListener('click', clearProgress);
    } catch (e) { panel.innerHTML = '<p class="muted">לא הצלחתי לטעון את נתוני ההתקדמות כרגע.</p>'; }
  }

  window.renderProgressDashboard = renderProgress;
  window.clearProgressDashboard = clearProgress;
})();