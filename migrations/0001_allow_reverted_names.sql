-- Migration number: 0001 	 2026-01-16T00:00:00.000Z

-- 1. Create NEW table with updated PRIMARY KEY (including first_seen_at)
-- This allows (id, name) to appear multiple times if the date is different.
CREATE TABLE IF NOT EXISTS PlayerAliases_new (
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    first_seen_at TEXT NOT NULL, -- e.g. "2024-10-19"
    PRIMARY KEY (player_id, normalized_name, first_seen_at),
    FOREIGN KEY (player_id) REFERENCES Players(id)
);

-- 2. Copy existing data
INSERT INTO PlayerAliases_new (player_id, name, normalized_name, first_seen_at)
SELECT player_id, name, normalized_name, first_seen_at FROM PlayerAliases;

-- 3. Drop old table
DROP TABLE PlayerAliases;

-- 4. Rename new table
ALTER TABLE PlayerAliases_new RENAME TO PlayerAliases;

-- 5. Re-create Indexes
CREATE INDEX IF NOT EXISTS idx_aliases_normalized_name ON PlayerAliases(normalized_name);
CREATE INDEX IF NOT EXISTS idx_aliases_player_id ON PlayerAliases(player_id);

-- 6. Re-create Triggers (Synced with PlayerSearch)
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
