(() => {
  async function recoverSession() {
    const modeBtn = document.querySelector('#modeBtn');
    try {
      const r = await fetch('/api/auth/status', {credentials:'same-origin', cache:'no-store'});
      if (r.ok) return;
      await fetch('/api/auth/logout', {
        method:'POST',
        credentials:'same-origin',
        headers:{'content-type':'application/json'},
        body:'{}'
      }).catch(()=>{});
      if (modeBtn) modeBtn.textContent = '🔒 ניהול';
    } catch (_) {
      // Offline/network errors must never leave the PWA UI blocked.
      if (modeBtn && !modeBtn.textContent) modeBtn.textContent = '🔒 ניהול';
    }
  }

  window.addEventListener('DOMContentLoaded', recoverSession);

  // If the installed PWA resumes after being suspended for a long time,
  // validate the server session again without forcing a reload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') recoverSession();
  });
})();