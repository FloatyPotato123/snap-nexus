-- Migration number: 0000 	 2024-01-09T00:00:00.000Z

-- 1. Main Players Table (Master Directory)
CREATE TABLE IF NOT EXISTS Players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_players_normalized_name ON Players(normalized_name);

-- 2. Player Aliases Table (Historical Names)
CREATE TABLE IF NOT EXISTS PlayerAliases (
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    first_seen_at TEXT NOT NULL, -- e.g. "2024-10-19"
    PRIMARY KEY (player_id, normalized_name),
    FOREIGN KEY (player_id) REFERENCES Players(id)
);

CREATE INDEX IF NOT EXISTS idx_aliases_normalized_name ON PlayerAliases(normalized_name);
CREATE INDEX IF NOT EXISTS idx_aliases_player_id ON PlayerAliases(player_id);

-- 3. FTS5 Search Table (Trigram for indexing substring matches)
-- Using tokenizer 'trigram' to allow searching for middle-of-word strings with index speed.
-- We store player_id as UNINDEXED so we can retrieve it instantly without joining.
CREATE VIRTUAL TABLE IF NOT EXISTS PlayerSearch USING fts5(
    player_id UNINDEXED,
    name,
    normalized_name,
    tokenize='trigram'
);

-- Trigger to keep Search Index in sync with PlayerAliases
CREATE TRIGGER IF NOT EXISTS idx_player_aliases_insert AFTER INSERT ON PlayerAliases BEGIN
  INSERT INTO PlayerSearch(player_id, name, normalized_name) VALUES (new.player_id, new.name, new.normalized_name);
END;

CREATE TRIGGER IF NOT EXISTS idx_player_aliases_delete AFTER DELETE ON PlayerAliases BEGIN
  DELETE FROM PlayerSearch WHERE normalized_name = old.normalized_name AND player_id = old.player_id;
END;

CREATE TRIGGER IF NOT EXISTS idx_player_aliases_update AFTER UPDATE ON PlayerAliases BEGIN
  DELETE FROM PlayerSearch WHERE normalized_name = old.normalized_name AND player_id = old.player_id;
  INSERT INTO PlayerSearch(player_id, name, normalized_name) VALUES (new.player_id, new.name, new.normalized_name);
END;
