-- Create Seasons table to track season rollover boundaries
CREATE TABLE IF NOT EXISTS Seasons (
    season_id TEXT PRIMARY KEY,       -- Format: "YYYY-MM" (e.g. "2026-07")
    start_date TEXT NOT NULL,         -- ISO 8601 UTC timestamp (e.g. "2026-06-30T19:00:00Z")
    end_date TEXT NOT NULL            -- ISO 8601 UTC timestamp (e.g. "2026-08-04T19:00:00Z")
);

CREATE INDEX IF NOT EXISTS idx_seasons_dates ON Seasons(start_date, end_date);

-- Seed with all historical season rollovers from October 2025 onwards
INSERT OR IGNORE INTO Seasons (season_id, start_date, end_date) VALUES 
('2025-10', '2025-10-07T19:00:00Z', '2025-11-04T19:00:00Z'),
('2025-11', '2025-11-04T19:00:00Z', '2025-12-02T19:00:00Z'),
('2025-12', '2025-12-02T19:00:00Z', '2026-01-06T19:00:00Z'),
('2026-01', '2026-01-06T19:00:00Z', '2026-02-03T19:00:00Z'),
('2026-02', '2026-02-03T19:00:00Z', '2026-03-03T19:00:00Z'),
('2026-03', '2026-03-03T19:00:00Z', '2026-04-07T19:00:00Z'),
('2026-04', '2026-04-07T19:00:00Z', '2026-05-05T19:00:00Z'),
('2026-05', '2026-05-05T19:00:00Z', '2026-06-02T19:00:00Z'),
('2026-06', '2026-06-02T19:00:00Z', '2026-06-30T19:00:00Z'),
('2026-07', '2026-06-30T19:00:00Z', '2026-08-04T19:00:00Z');
