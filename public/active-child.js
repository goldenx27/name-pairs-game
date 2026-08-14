(() => {
  const $ = s => document.querySelector(s);
  let observer = null;
  let setupObserver = null;

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
      panel.innerHTML = `<div style="text-align:center;padding:18px 8px"><div style="font-size:44px;margin-bottom:8px">🎮</div><h2 style="margin:0 0 8px">לא נבחר ילד פעיל</h2><p class="muted" style="margin:0">כדי להתחיל לשחק, היכנסו ל־ניהול ובחרו ילד באמצעות „הפוך לפעיל”.</p></div>`;
      document.querySelector('main.app > header')?.insertAdjacentElement('afterend', panel);
    }
    // Do not cover an authenticated management screen.
    if ($('#accessPanel') && !$('#accessPanel').classList.contains('hidden')) panel.classList.add('hidden');
    else panel.classList.remove('hidden');
  }

  function syncChildButtons() {
    document.querySelectorAll('.childRow').forEach(row => {
      const btn = row.querySelector('.playChild');
      if (!btn) return;
      const isActive = !!localStorage.playerId && row.dataset.player === localStorage.playerId;
      const wantedText = isActive ? '⏸️ השבת' : '🎮 הפוך לפעיל';
      if (btn.textContent !== wantedText) btn.textContent = wantedText;
      btn.classList.toggle('danger', isActive);
      btn.classList.toggle('ghost', !isActive);
      row.classList.toggle('activeChildRow', isActive);
    });
  }

  function watchChildRows() {
    observer?.disconnect();
    const rows = $('#childRows');
    if (!rows) return;
    observer = new MutationObserver(syncChildButtons);
    observer.observe(rows, {childList:true});
  }

  function lockLegacySetup() {
    const setup = $('#setup');
    if (!setup) return;
    setupObserver?.disconnect();
    setupObserver = new MutationObserver(() => {
      if (!localStorage.playerId && !setup.classList.contains('hidden')) {
        setup.classList.add('hidden');
        showLockedGame();
      }
    });
    setupObserver.observe(setup, {attributes:true, attributeFilter:['class']});
    if (!localStorage.playerId) setup.classList.add('hidden');
  }

  document.addEventListener('click', async e => {
    const btn = e.target.closest('.playChild');
    if (!btn) return;
    const row = btn.closest('.childRow');
    if (!row) return;
    if (localStorage.playerId && row.dataset.player === localStorage.playerId) {
      e.preventDefault();
      e.stopImmediatePropagation();
      localStorage.removeItem('playerId');
      localStorage.removeItem('familyId');
      syncChildButtons();
      await window.refreshActiveChildManagement?.();
      // Stay in management. The locked game is shown only after logout.
      $('#noActiveChild')?.classList.add('hidden');
    }
  }, true);

  window.showActiveChildLock = showLockedGame;
  window.syncActiveChildButtons = syncChildButtons;

  window.addEventListener('DOMContentLoaded', () => {
    showLockedGame();
    syncChildButtons();
    watchChildRows();
    lockLegacySetup();
  });
})();