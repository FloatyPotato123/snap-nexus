/**
 * Cloudflare D1 Database Utilities
 * 
 * Provides database access functions for:
 * - Player search (FTS5 full-text search)
 * - Player name history tracking
 * - Daily stats recording and retrieval
 * - Batch operations for efficient data processing
 * 
 * All functions handle errors gracefully and return empty results on failure.
 */

import { logError } from './errors.js';
import { DB_BATCH_SIZE_PLAYERS, DB_BATCH_SIZE_STATS, SEARCH_MIN_QUERY_LENGTH } from '../config.js';

// ============================================================================
// Player Search
// ============================================================================

/**
 * Searches for players by name using full-text search.
 * 
 * Uses the FTS5 virtual table (PlayerSearch) with trigram indexing
 * to find players by current name or any historical alias.
 * 
 * @param {Object} db - D1 database instance
 * @param {string} query - Search query (case-insensitive)
 * @param {number} [limit=10] - Maximum number of results
 * @returns {Promise<Array<{id: string, name: string}>>} Array of matching players
 */
export async function searchPlayers(db, query, limit = 10) {
    if (!query || query.length < SEARCH_MIN_QUERY_LENGTH) {
        return [];
    }

    const normalized = query.toLowerCase();

    // Wrap query in quotes to avoid FTS5 syntax errors with reserved words
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
    } catch (error) {
        logError('[DB Search]', error, { query, limit });
        return [];
    }
}

// ============================================================================
// Player Data Management
// ============================================================================

/**
 * Batch upserts player data with intelligent name change detection.
 * 
 * This function:
 * 1. Updates the Players table with current names
 * 2. Adds new entries to PlayerAliases only when names change
 * 3. Processes in chunks to avoid SQLite bind limits
 * 
 * Optimization: Only writes to the database when a player's name has changed,
 * reducing unnecessary writes during daily scrapes.
 * 
 * @param {Object} db - D1 database instance
 * @param {Array<{id: string, name: string}>} players - Array of player data
 * @param {string} [seenAt] - Date string (YYYY-MM-DD), defaults to today
 * @returns {Promise<void>}
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

    // Process in chunks to avoid SQLite bind limits
    for (let i = 0; i < players.length; i += DB_BATCH_SIZE_PLAYERS) {
        const chunk = players.slice(i, i + DB_BATCH_SIZE_PLAYERS);
        const playerIds = chunk.map(p => p.id);

        // Fetch existing history for this chunk to detect name changes
        let historyMap = {};
        try {
            historyMap = await batchGetPlayerHistories(db, playerIds);
        } catch (error) {
            logError('[DB Batch Upsert]', error, { chunkIndex: i });
        }

        const statements = [];

        for (const p of chunk) {
            if (!p.id || !p.name) continue;

            const normalized = p.name.toLowerCase();
            const history = historyMap[p.id];

            // Only write if name has changed (optimization)
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
            } catch (error) {
                logError('[DB Batch Execute]', error, { chunkIndex: i, statementCount: statements.length });
            }
        }
    }
}

// ============================================================================
// Player History
// ============================================================================

/**
 * Retrieves the name history for a single player.
 * 
 * Returns all known names for a player, ordered chronologically.
 * Replaces the legacy 'history:' KV keys.
 * 
 * @param {Object} db - D1 database instance
 * @param {string} playerId - Player ID
 * @returns {Promise<Array<{name: string, seenAt: string}>>} Name history
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
    } catch (error) {
        logError('[DB History]', error, { playerId });
        return [];
    }
}

/**
 * Retrieves name history for multiple players in a single query.
 * 
 * More efficient than calling getPlayerHistory() multiple times.
 * 
 * @param {Object} db - D1 database instance
 * @param {Array<string>} playerIds - Array of player IDs
 * @returns {Promise<Object<string, Array<{name: string, seenAt: string}>>>} Map of playerId to history
 */
export async function batchGetPlayerHistories(db, playerIds) {
    if (!playerIds || playerIds.length === 0) return {};

    // Build SQL with placeholders for IN clause
    const placeholders = playerIds.map(() => '?').join(',');
    const sql = `
        SELECT player_id, name, first_seen_at as seenAt 
        FROM PlayerAliases 
        WHERE player_id IN (${placeholders})
        ORDER BY first_seen_at ASC
    `;

    try {
        const { results } = await db.prepare(sql).bind(...playerIds).all();

        // Group results by player_id
        const map = {};
        (results || []).forEach(row => {
            if (!map[row.player_id]) {
                map[row.player_id] = [];
            }
            map[row.player_id].push({ name: row.name, seenAt: row.seenAt });
        });

        return map;
    } catch (error) {
        logError('[DB Batch History]', error, { playerCount: playerIds.length });
        return {};
    }
}

// ============================================================================
// Player Stats
// ============================================================================

/**
 * Retrieves historical ranks for a player on specific dates.
 * 
 * Used to fetch season-end rankings for the historical chart.
 * 
 * @param {Object} db - D1 database instance
 * @param {string} playerId - Player ID
 * @param {Array<string>} dates - Array of dates (YYYY-MM-DD)
 * @returns {Promise<Array<{date: string, rank: number, sp: number}>>} Historical ranks
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
    } catch (error) {
        logError('[DB Historical Ranks]', error, { playerId, dateCount: dates.length });
        return [];
    }
}

/**
 * Retrieves daily stats for a player within a date range.
 * 
 * Used for the season performance chart on player profiles.
 * 
 * @param {Object} db - D1 database instance
 * @param {string} playerId - Player ID
 * @param {string} start - Start date (YYYY-MM-DD)
 * @param {string} end - End date (YYYY-MM-DD)
 * @returns {Promise<Array<{date: string, rank: number, score: number}>>} Daily stats
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
    } catch (error) {
        logError('[DB Stats Range]', error, { playerId, start, end });
        return [];
    }
}

/**
 * Records daily player stats in bulk.
 * 
 * Processes in chunks to stay under the 1000 sub-request limit
 * per Worker invocation.
 * 
 * @param {Object} db - D1 database instance
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {Array<{playerId: string, rank: number, score: number}>} entries - Player stats
 * @returns {Promise<void>}
 */
export async function recordPlayerStats(db, date, entries) {
    if (!entries || entries.length === 0) return;

    const sql = `INSERT OR REPLACE INTO PlayerStats (player_id, date, rank, score) VALUES (?, ?, ?, ?)`;
    const stmt = db.prepare(sql);

    // Process in chunks to stay under Worker sub-request limits
    for (let i = 0; i < entries.length; i += DB_BATCH_SIZE_STATS) {
        const chunk = entries.slice(i, i + DB_BATCH_SIZE_STATS);
        const statements = chunk.map(p => stmt.bind(p.playerId || p.id, date, p.rank, p.score));

        try {
            await db.batch(statements);
        } catch (error) {
            logError('[DB Record Stats]', error, { date, chunkIndex: i, chunkSize: chunk.length });
        }
    }
}

// ============================================================================
// Daily Totals
// ============================================================================

/**
 * Records the total number of Infinite players for a given date.
 * 
 * @param {Object} db - D1 database instance
 * @param {string} date - Date (YYYY-MM-DD)
 * @param {number} total - Total Infinite player count
 * @returns {Promise<void>}
 */
export async function recordDailyTotal(db, date, total) {
    const sql = `INSERT OR REPLACE INTO DailyTotals (date, total) VALUES (?, ?)`;

    try {
        await db.prepare(sql).bind(date, total).run();
    } catch (error) {
        logError('[DB Daily Total]', error, { date, total });
    }
}

/**
 * Retrieves daily Infinite player totals for a date range.
 * 
 * @param {Object} db - D1 database instance
 * @param {string} start - Start date (YYYY-MM-DD)
 * @param {string} end - End date (YYYY-MM-DD)
 * @returns {Promise<Array<{date: string, total: number}>>} Daily totals
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
    } catch (error) {
        logError('[DB Totals Range]', error, { start, end });
        return [];
    }
}

