(() => {
  const $ = s => document.querySelector(s);

  function showLockedGame() {
    if (localStorage.playerId) return;

    $('#setup')?.classList.add('hidden');
    $('#game')?.classList.add('hidden');
    $('#crew')?.classList.add('hidden');

    let panel = $('#noActiveChild');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'noActiveChild';
      panel.className = 'card';
      panel.innerHTML = `
        <div style="text-align:center;padding:18px 8px">
          <div style="font-size:44px;margin-bottom:8px">🎮</div>
          <h2 style="margin:0 0 8px">לא נבחר ילד פעיל</h2>
          <p class="muted" style="margin:0">כדי להתחיל לשחק, היכנסו ל־ניהול ובחרו ילד באמצעות „הפוך לפעיל”.</p>
        </div>`;
      const header = document.querySelector('main.app > header');
      header?.insertAdjacentElement('afterend', panel);
    }
    panel.classList.remove('hidden');
  }

  function syncChildButtons() {
    document.querySelectorAll('.childRow').forEach(row => {
      const btn = row.querySelector('.playChild');
      if (!btn) return;
      const isActive = !!localStorage.playerId && row.dataset.player === localStorage.playerId;
      btn.textContent = isActive ? '⏸️ השבת' : '🎮 הפוך לפעיל';
      btn.classList.toggle('danger', isActive);
      btn.classList.toggle('ghost', !isActive);
      row.classList.toggle('activeChildRow', isActive);

      const name = row.querySelector('b');
      if (name) {
        const existing = name.querySelector('.activePill');
        if (isActive && !existing) name.insertAdjacentHTML('beforeend', ' <span class="activePill">פעיל</span>');
        if (!isActive && existing) existing.remove();
      }
    });
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.playChild');
    if (!btn) return;
    const row = btn.closest('.childRow');
    if (!row) return;

    if (localStorage.playerId && row.dataset.player === localStorage.playerId) {
      e.preventDefault();
      e.stopImmediatePropagation();
      localStorage.removeItem('playerId');
      location.reload();
    }
  }, true);

  const observer = new MutationObserver(() => syncChildButtons());

  window.addEventListener('DOMContentLoaded', () => {
    if (!localStorage.playerId) showLockedGame();
    syncChildButtons();
    const rows = $('#childRows');
    if (rows) observer.observe(rows, {childList:true, subtree:true});
    else observer.observe(document.body, {childList:true, subtree:true});
  });
})();