(() => {
  const originalFetch = window.fetch.bind(window);

  function dedupeSoundPairs(data) {
    if (!data || data.type !== 'sound_pairs' || !Array.isArray(data.cards)) return data;

    const images = data.cards.filter(card => card.kind === 'image');
    const sounds = data.cards.filter(card => card.kind === 'sound');
    const soundByGroup = new Map();
    for (const sound of sounds) {
      if (!sound.soundGroup || soundByGroup.has(sound.soundGroup)) continue;
      soundByGroup.set(sound.soundGroup, sound);
    }

    const selectedImages = [];
    const usedGroups = new Set();
    for (const image of images) {
      const group = image.soundGroup;
      if (!group || usedGroups.has(group) || !soundByGroup.has(group)) continue;
      usedGroups.add(group);
      selectedImages.push(image);
    }

    const selectedSounds = selectedImages.map(image => soundByGroup.get(image.soundGroup));
    data.cards = [...selectedImages, ...selectedSounds].sort(() => Math.random() - .5);
    data.uniqueSoundGroups = usedGroups.size;
    return data;
  }

  window.fetch = async function(input, init) {
    const response = await originalFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (!url.includes('/api/game/next')) return response;

      const clone = response.clone();
      const data = await clone.json();
      if (data?.type !== 'sound_pairs') return response;

      const fixed = dedupeSoundPairs(data);
      return new Response(JSON.stringify(fixed), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch {
      return response;
    }
  };
})();
