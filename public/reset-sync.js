(() => {
  const originalFetch = window.fetch.bind(window);
  const RESET_PENDING_KEY = 'crewGameResetPending';

  window.fetch = async (...args) => {
    const input = args[0];
    const options = args[1] || {};
    const url = typeof input === 'string' ? input : (input?.url || '');
    const method = String(options.method || input?.method || 'GET').toUpperCase();

    const response = await originalFetch(...args);

    if (response.ok && method === 'POST' && /^\/api\/players\/[^/]+\/reset(?:\?|$)/.test(url)) {
      localStorage.setItem(RESET_PENDING_KEY, '1');
    }

    if (response.ok && method === 'POST' && /\/api\/auth\/logout(?:\?|$)/.test(url)) {
      if (localStorage.getItem(RESET_PENDING_KEY) === '1') {
        localStorage.removeItem(RESET_PENDING_KEY);
        setTimeout(() => location.reload(), 0);
      }
    }

    return response;
  };
})();