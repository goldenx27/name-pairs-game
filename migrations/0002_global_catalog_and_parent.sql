PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO families(id, name, parent_pin_hash)
VALUES('catalog_global', 'Global Character Catalog', NULL);

UPDATE characters SET family_id='catalog_global';

ALTER TABLE player_state ADD COLUMN rounds_since_unlock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_state ADD COLUMN last_character_id TEXT;
ALTER TABLE player_state ADD COLUMN last_game_type TEXT;

UPDATE player_state SET current_pool_size=2 WHERE current_pool_size>2;
