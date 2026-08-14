(() => {
  const $ = s => document.querySelector(s);
  let observer = null;
  let setupObserver = null;

  function ensureActiveChildChip() {
    const headerActions = document.querySelector('.headerActions');
    if (!headerActions) return null;
    let chip = $('#activeChildTopChip');
    if (!chip) {
      chip = document.createElement('span');
      chip.id = 'activeChildTopChip';
      chip.className = 'activeChildTopChip hidden';
      chip.setAttribute('aria-label', 'הילד הפעיל');
      headerActions.insertBefore(chip, $('#modeBtn') || null);
    }
    return chip;
  }

  function syncTopChip() {
    const chip = ensureActiveChildChip();
    if (!chip) return;
    const name = localStorage.activeChildName;
    const visible = !!localStorage.playerId && !!name;
    chip.textContent = visible ? `🎮 ${name}` : '';
    chip.classList.toggle('hidden', !visible);
  }

  function showLockedGame() {
    if (localStorage.playerId) {
      $('#noActiveChild')?.classList.add('hidden');
      syncTopChip();
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
    if ($('#accessPanel') && !$('#accessPanel').classList.contains('hidden')) panel.classList.add('hidden');
    else panel.classList.remove('hidden');
    syncTopChip();
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
      if (isActive && row.dataset.name) localStorage.activeChildName = row.dataset.name;
    });
    syncTopChip();
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
    const isActive = !!localStorage.playerId && row.dataset.player === localStorage.playerId;
    if (isActive) {
      e.preventDefault();
      e.stopImmediatePropagation();
      localStorage.removeItem('playerId');
      localStorage.removeItem('familyId');
      localStorage.removeItem('activeChildName');
      syncChildButtons();
      await window.refreshActiveChildManagement?.();
      $('#noActiveChild')?.classList.add('hidden');
      return;
    }
    if (row.dataset.name) localStorage.activeChildName = row.dataset.name;
    syncTopChip();
  }, true);

  window.showActiveChildLock = showLockedGame;
  window.syncActiveChildButtons = syncChildButtons;
  window.syncActiveChildTopChip = syncTopChip;

  window.addEventListener('DOMContentLoaded', () => {
    ensureActiveChildChip();
    showLockedGame();
    syncChildButtons();
    watchChildRows();
    lockLegacySetup();
  });
})();