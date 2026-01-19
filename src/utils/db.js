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
    let shouldInsert = true;
    if (history && history.length > 0) {
        const latest = history[history.length - 1];
        if (latest.name === name) {
            shouldInsert = false;
        }
    }

    try {
        const batch = [db.prepare(sqlMain).bind(id, name, normalized, now)];
        if (shouldInsert) {
            batch.push(db.prepare(sqlAlias).bind(id, name, normalized, date));
        }
        await db.batch(batch);
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
            // Continue with empty history (safe fallback, might duplicate aliases but won't crash)
        }

        const statements = [];

        for (const p of chunk) {
            if (!p.id || !p.name) continue;
            const normalized = p.name.toLowerCase();

            // Update Master Table (Always updates "Current Name")
            statements.push(stmtMain.bind(p.id, p.name, normalized, now));

            // Logic: Should we insert a new history entry?
            const history = historyMap[p.id];
            let shouldInsert = true;

            if (history && history.length > 0) {
                const latest = history[history.length - 1];
                if (latest.name === p.name) {
                    shouldInsert = false;
                }
            }

            if (shouldInsert) {
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
