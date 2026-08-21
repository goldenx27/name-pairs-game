ALTER TABLE characters ADD COLUMN sound_audio_key TEXT;
ALTER TABLE characters ADD COLUMN sound_group TEXT;

UPDATE characters SET sound_group = CASE
  WHEN name IN ('אבי', 'אפצ''י', 'אפצ׳י') THEN 'haaa'
  WHEN name = 'סבתא שלומית' THEN 'sh'
  WHEN name = 'אילנית' THEN 'he'
  WHEN name = 'אורן' THEN 'o'
  WHEN name IN ('אורי', 'אורים קטנים') THEN 'uow'
  WHEN name IN ('אפרת', 'אפריים') THEN 'aee'
  ELSE NULL
END;
