CREATE TABLE IF NOT EXISTS speech_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  target_text TEXT NOT NULL,
  prompt_text TEXT,
  image_key TEXT NOT NULL,
  prompt_audio_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS speech_attempts (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  response_audio_key TEXT NOT NULL,
  transcript TEXT,
  score REAL,
  result TEXT NOT NULL DEFAULT 'pending',
  evaluator TEXT NOT NULL DEFAULT 'pending_stt',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evaluated_at TEXT,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES speech_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_speech_attempts_player ON speech_attempts(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_speech_attempts_item ON speech_attempts(item_id, created_at);
