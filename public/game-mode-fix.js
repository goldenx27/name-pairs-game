// UX patch: "Who is it?" = hear one name, then choose the matching picture.
// Loaded before app.js so it can observe every new round without duplicating the game engine.
(() => {
  const nativeFetch = window.fetch.bind(window);
  let lastRound = null;

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const url = String(args[0] || '');
    if (url.includes('/api/game/next')) {
      response.clone().json().then(data => { lastRound = data; }).catch(() => {});
    }
    return response;
  };

  const enhanceWhoRound = () => {
    const stage = document.querySelector('#gameStage');
    const audioChoices = stage?.querySelector('.audioChoices');
    if (!stage || !audioChoices || !lastRound || lastRound.type !== 'who_is_it' || stage.dataset.whoEnhanced === '1') return;

    stage.dataset.whoEnhanced = '1';
    const originalButtons = [...audioChoices.querySelectorAll('.audioChoice')];
    if (!originalButtons.length) return;

    // The question is spoken automatically. Reading is optional.
    document.querySelector('#prompt').textContent = 'מי זה? 👂';
    const replay = document.querySelector('#playAgain');
    replay?.classList.remove('hidden');
    const speakQuestion = () => new Audio(lastRound.target.audio).play().catch(() => {});
    if (replay) replay.onclick = speakQuestion;
    speakQuestion();

    // Keep the original answer buttons hidden: clicking a picture delegates to the
    // existing game engine, so scoring/unlocking logic stays exactly the same.
    audioChoices.style.display = 'none';
    const pictureChoices = document.createElement('div');
    pictureChoices.className = 'choices whoPictureChoices';

    lastRound.options.forEach(option => {
      const slot = option.id === lastRound.target.id
        ? Number(lastRound.imageSlot || 1)
        : (Math.random() < 0.5 ? 1 : 2);
      const button = document.createElement('button');
      button.className = 'choice whoPictureChoice';
      button.dataset.id = option.id;
      button.innerHTML = `<img src="${slot === 1 ? option.image1 : option.image2}" alt="">`;
      button.onclick = () => {
        pictureChoices.querySelectorAll('button').forEach(b => { b.disabled = true; });
        const original = originalButtons.find(b => b.dataset.id === option.id);
        original?.click();
        button.classList.add(option.id === lastRound.target.id ? 'good' : 'bad');
      };
      pictureChoices.appendChild(button);
    });

    stage.querySelector('.whoCard')?.remove();
    stage.appendChild(pictureChoices);
  };

  new MutationObserver(enhanceWhoRound).observe(document.documentElement, {subtree:true, childList:true});
})();
