/**
 * Cloudflare D1 Database Helper
 * Handles Search Indexing and Querying
 */

/**
 * Search for players by name (case-insensitive substring)
 * Uses PlayerAliases to find any name the player has ever used.
 * @param {D1Database} db 
 * @param {string} query 
 * @param {number} limit 
 */
export async function searchPlayers(db, query, limit = 10) {
    if (!query || query.length < 2) return [];

    const normalized = query.toLowerCase();

    // Search using FTS5 virtual table (Trigram indexed)
    // Wrap in quotes to avoid FTS5 syntax errors with reserved words like "AND"
    const sql = `
        SELECT DISTINCT player_id as id, name 
        FROM PlayerSearch 
        WHERE PlayerSearch MATCH ? 
        ORDER BY rank 
        LIMIT ?
    `;

    try {
        const { results } = await db.prepare(sql)
            .bind(`"${normalized}"*`, limit)
            .run();
        return results || [];
    } catch (e) {
        console.error("DB Search Error:", e);
        return [];
    }
}

/**
 * Upsert (Insert or Replace) a player in the index
 * Updates the main Players table AND adds to PlayerAliases.
 * @param {D1Database} db 
 * @param {string} id 
 * @param {string} name 
 * @param {string} seenAt Optional date string
 */
export async function upsertPlayer(db, id, name, seenAt) {
    if (!id || !name) return;

    const normalized = name.toLowerCase();
    const now = Date.now();
    const date = seenAt || new Date().toISOString().split('T')[0];

    const sqlMain = `
        INSERT INTO Players (id, name, normalized_name, updated_at) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET 
            name = excluded.name,
            normalized_name = excluded.normalized_name,
            updated_at = excluded.updated_at
    `;

    const sqlAlias = `
        INSERT INTO PlayerAliases (player_id, name, normalized_name, first_seen_at)
        VALUES (?, ?, ?, ?)
    `;

    const history = await getPlayerHistory(db, id);
    let nameChanged = true;
    if (history && history.length > 0) {
        const latest = history[history.length - 1];
        if (latest.name === name) {
            nameChanged = false;
        }
    }

    try {
        const batch = [];
        // Only update identity if name actually changed
        if (nameChanged) {
            batch.push(db.prepare(sqlMain).bind(id, name, normalized, now));
            batch.push(db.prepare(sqlAlias).bind(id, name, normalized, date));
        }

        if (batch.length > 0) {
            await db.batch(batch);
        }
    } catch (e) {
        console.error("DB Upsert Error:", id, name, e);
        throw e;
    }
}

/**
 * Batch Upsert (For Scraper/Live Sync or Snapshot Migration)
 * Updates Master Name and intelligent history insertion (A -> B -> A support).
 * @param {D1Database} db 
 * @param {Array<{id, name}>} players 
 * @param {string} seenAt Optional date string (e.g. "2024-10-19")
 */
export async function batchUpsertPlayers(db, players, seenAt) {
    if (!players || players.length === 0) return;

    const now = Date.now();
    const date = seenAt || new Date().toISOString().split('T')[0];

    const sqlMain = `
        INSERT INTO Players (id, name, normalized_name, updated_at) 
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET 
            name = excluded.name,
            normalized_name = excluded.normalized_name,
            updated_at = excluded.updated_at
    `;

    const sqlAlias = `
        INSERT INTO PlayerAliases (player_id, name, normalized_name, first_seen_at)
        VALUES (?, ?, ?, ?)
    `;

    const stmtMain = db.prepare(sqlMain);
    const stmtAlias = db.prepare(sqlAlias);

    // Process in chunks to avoid SQLite bind limits on both READ and WRITE
    const PROCESS_CHUNK_SIZE = 50;

    for (let i = 0; i < players.length; i += PROCESS_CHUNK_SIZE) {
        const chunk = players.slice(i, i + PROCESS_CHUNK_SIZE);
        const playerIds = chunk.map(p => p.id);

        // 1. Bulk Fetch History for this chunk
        let historyMap = {};
        try {
            historyMap = await batchGetPlayerHistories(db, playerIds);
        } catch (e) {
            console.error(`Batch History Fetch Error (Chunk ${i}):`, e);
        }

        const statements = [];

        for (const p of chunk) {
            if (!p.id || !p.name) continue;
            const normalized = p.name.toLowerCase();

            // Logic: Periodic Identity Update (Write Optimization)
            // Only update history AND master record if name actually changed.
            const history = historyMap[p.id];
            let nameChanged = true;

            if (history && history.length > 0) {
                const latest = history[history.length - 1];
                if (latest.name === p.name) {
                    nameChanged = false;
                }
            }

            if (nameChanged) {
                statements.push(stmtMain.bind(p.id, p.name, normalized, now));
                statements.push(stmtAlias.bind(p.id, p.name, normalized, date));
            }
        }

        if (statements.length > 0) {
            try {
                await db.batch(statements);
            } catch (e) {
                console.error(`Batch Upsert Error (Chunk ${i}):`, e);
            }
        }
    }
}


/**
 * Get name history for a player
 * Replaces the 'history:' KV keys.
 * @param {D1Database} db 
 * @param {string} playerId 
 */
export async function getPlayerHistory(db, playerId) {
    if (!playerId) return [];

    const sql = `
        SELECT name, first_seen_at as seenAt 
        FROM PlayerAliases 
        WHERE player_id = ? 
        ORDER BY first_seen_at ASC
    `;

    try {
        const { results } = await db.prepare(sql).bind(playerId).all();
        return results || [];
    } catch (e) {
        console.error("DB History Error:", playerId, e);
        return [];
    }
}

/**
 * Get name history for multiple players in one query
 * @param {D1Database} db 
 * @param {Array<string>} playerIds 
 */
export async function batchGetPlayerHistories(db, playerIds) {
    if (!playerIds || playerIds.length === 0) return {};

    // SQLite doesn't support arrays directly, so we build placeholders
    const placeholders = playerIds.map(() => '?').join(',');
    const sql = `
        SELECT player_id, name, first_seen_at as seenAt 
        FROM PlayerAliases 
        WHERE player_id IN (${placeholders})
        ORDER BY first_seen_at ASC
    `;

    try {
        const { results } = await db.prepare(sql).bind(...playerIds).all();

        // Group by player_id
        const map = {};
        (results || []).forEach(row => {
            if (!map[row.player_id]) map[row.player_id] = [];
            map[row.player_id].push({ name: row.name, seenAt: row.seenAt });
        });
        return map;
    } catch (e) {
        console.error("DB Batch History Error:", e);
        return {};
    }
}

/**
 * Get player stats for a specific set of dates (e.g. season ends)
 * @param {D1Database} db 
 * @param {string} playerId 
 * @param {Array<string>} dates 
 */
export async function getPlayerHistoricalRanks(db, playerId, dates) {
    if (!dates || dates.length === 0) return [];

    const placeholders = dates.map(() => '?').join(',');
    const sql = `
        SELECT date, rank, score as sp
        FROM PlayerStats
        WHERE player_id = ? AND date IN (${placeholders})
        ORDER BY date ASC
    `;

    try {
        const { results } = await db.prepare(sql).bind(playerId, ...dates).all();
        return results || [];
    } catch (e) {
        console.error("DB Historical Ranks Error:", e);
        return [];
    }
}


/**
 * Record daily total infinite player count
 */
export async function recordDailyTotal(db, date, total) {
    const sql = `INSERT OR REPLACE INTO DailyTotals (date, total) VALUES (?, ?)`;
    try {
        await db.prepare(sql).bind(date, total).run();
    } catch (e) {
        console.error("DB DailyTotal Error:", e);
    }
}

/**
 * Record daily player ranking/score stats in bulk
 */
export async function recordPlayerStats(db, date, entries) {
    if (!entries || entries.length === 0) return;

    const sql = `INSERT OR REPLACE INTO PlayerStats (player_id, date, rank, score) VALUES (?, ?, ?, ?)`;
    const stmt = db.prepare(sql);

    // Process in larger chunks to stay under the 1000 sub-request limit per Worker invocation
    const CHUNK_SIZE = 500;
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        const chunk = entries.slice(i, i + CHUNK_SIZE);
        const statements = chunk.map(p => stmt.bind(p.playerId || p.id, date, p.rank, p.score));
        try {
            await db.batch(statements);
        } catch (e) {
            console.error("DB PlayerStats Error:", e);
        }
    }
}

/**
 * Get historical stats for a single player
 */
export async function getPlayerStatsRange(db, playerId, start, end) {
    const sql = `
        SELECT date, rank, score 
        FROM PlayerStats 
        WHERE player_id = ? AND date BETWEEN ? AND ?
        ORDER BY date ASC
    `;
    try {
        const { results } = await db.prepare(sql).bind(playerId, start, end).all();
        return results || [];
    } catch (e) {
        console.error("DB GetStats Error:", e);
        return [];
    }
}

/**
 * Get historical daily totals for a range
 */
export async function getDailyTotalsRange(db, start, end) {
    const sql = `
        SELECT date, total 
        FROM DailyTotals 
        WHERE date BETWEEN ? AND ?
        ORDER BY date ASC
    `;
    try {
        const { results } = await db.prepare(sql).bind(start, end).all();
        return results || [];
    } catch (e) {
        console.error("DB GetTotals Error:", e);
        return [];
    }
}
