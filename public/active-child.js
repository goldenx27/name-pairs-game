(() => {
  const $ = s => document.querySelector(s);
  let observer = null;

  function showLockedGame() {
    if (localStorage.playerId) {
      $('#noActiveChild')?.classList.add('hidden');
      return;
    }

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
      const wantedText = isActive ? '⏸️ השבת' : '🎮 הפוך לפעיל';
      if (btn.textContent !== wantedText) btn.textContent = wantedText;
      if (btn.classList.contains('danger') !== isActive) btn.classList.toggle('danger', isActive);
      if (btn.classList.contains('ghost') === isActive) btn.classList.toggle('ghost', !isActive);
      if (row.classList.contains('activeChildRow') !== isActive) row.classList.toggle('activeChildRow', isActive);

      const name = row.querySelector('b');
      if (name) {
        const existing = name.querySelector('.activePill');
        if (isActive && !existing) name.insertAdjacentHTML('beforeend', ' <span class="activePill">פעיל</span>');
        if (!isActive && existing) existing.remove();
      }
    });
  }

  function watchChildRows() {
    observer?.disconnect();
    const rows = $('#childRows');
    if (!rows) return;
    observer = new MutationObserver(() => syncChildButtons());
    // Only watch replacement/addition of direct child rows. Watching the whole
    // subtree caused our own button text/class updates to retrigger forever.
    observer.observe(rows, {childList:true});
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
      localStorage.removeItem('familyId');
      location.reload();
    }
  }, true);

  window.addEventListener('DOMContentLoaded', () => {
    showLockedGame();
    syncChildButtons();
    watchChildRows();
  });
})();