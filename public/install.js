(() => {
  let installPrompt = null;
  const button = document.querySelector('#installAppBtn');
  if (!button) return;

  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    button.classList.remove('hidden');
  });

  button.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    button.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => button.classList.add('hidden'));
})();
