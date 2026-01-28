-- Track daily player rank and score
CREATE TABLE IF NOT EXISTS PlayerStats (
    player_id TEXT,
    date TEXT,      -- Format: 'YYYY-MM-DD'
    rank INTEGER,
    score INTEGER,
    PRIMARY KEY (player_id, date)
);
CREATE INDEX IF NOT EXISTS idx_stats_player ON PlayerStats(player_id);

-- Track daily total infinite player count
CREATE TABLE IF NOT EXISTS DailyTotals (
    date TEXT PRIMARY KEY,
    total INTEGER
);
