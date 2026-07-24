CREATE TABLE IF NOT EXISTS PlayerRollingHistory (
    player_id TEXT NOT NULL,
    date TEXT NOT NULL,
    history_json TEXT NOT NULL,
    PRIMARY KEY (player_id, date)
);
