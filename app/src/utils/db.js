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

    // Deduplicate by name and prioritize older "real" IDs if they exist
    // We group by normalized_name to collapse duplicates
    const sql = `
        SELECT MIN(player_id) as id, name
        FROM PlayerSearch 
        WHERE PlayerSearch MATCH ? 
        GROUP BY LOWER(TRIM(name))
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

    for (let i = 0; i < players.length; i += DB_BATCH_SIZE_PLAYERS) {
        const chunk = players.slice(i, i + DB_BATCH_SIZE_PLAYERS);
        const playerIds = chunk.map(p => p.id);

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
                logError('[DB Batch Execute]', error, { chunkIndex: i });
            }
        }
    }
}

// ============================================================================
// Player History
// ============================================================================

/**
 * Returns a bound statement for the merged name history.
 */
export function getPlayerHistoryDeepStmt(db, playerId) {
    if (!playerId) return null;
    const sql = `
        SELECT name, MIN(first_seen_at) as seenAt 
        FROM PlayerAliases 
        WHERE player_id IN (
            SELECT player_id FROM PlayerAliases WHERE normalized_name IN (
                SELECT normalized_name FROM PlayerAliases WHERE player_id = ? OR normalized_name = ?
            )
        )
        AND name != 'Unknown'
        GROUP BY name
        ORDER BY seenAt ASC
    `;
    const normalizedId = playerId.toLowerCase();
    return db.prepare(sql).bind(playerId, normalizedId);
}

/**
 * Retrieves the merged name history for a player and all their aliases.
 */
export async function getPlayerHistoryDeep(db, playerId) {
    const stmt = getPlayerHistoryDeepStmt(db, playerId);
    if (!stmt) return [];
    try {
        const { results } = await stmt.all();
        return results || [];
    } catch (error) {
        logError('[DB History Deep]', error, { playerId });
        return [];
    }
}

/**
 * Retrieves the name history for a single player.
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
 */
export async function batchGetPlayerHistories(db, playerIds) {
    if (!playerIds || playerIds.length === 0) return {};
    const placeholders = playerIds.map(() => '?').join(',');
    const sql = `
        SELECT player_id, name, first_seen_at as seenAt 
        FROM PlayerAliases 
        WHERE player_id IN (${placeholders})
        ORDER BY first_seen_at ASC
    `;
    try {
        const { results } = await db.prepare(sql).bind(...playerIds).all();
        const map = {};
        (results || []).forEach(row => {
            if (!map[row.player_id]) map[row.player_id] = [];
            map[row.player_id].push({ name: row.name, seenAt: row.seenAt });
        });
        return map;
    } catch (error) {
        logError('[DB Batch History]', error);
        return {};
    }
}

/**
 * Efficiently maps names to existing player IDs.
 * Used by the scraper and profile handler to maintain continuity.
 */
export async function batchGetIdsByNames(db, names) {
    if (!names || names.length === 0) return {};

    const BATCH_SIZE = 100; // Stay well under D1 limits
    const map = {};

    for (let i = 0; i < names.length; i += BATCH_SIZE) {
        const chunk = names.slice(i, i + BATCH_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const sql = `
            SELECT normalized_name as name, player_id 
            FROM PlayerAliases 
            WHERE normalized_name IN (${placeholders})
        `;

        try {
            const { results } = await db.prepare(sql).bind(...chunk).all();
            (results || []).forEach(row => {
                const nameKey = row.name;
                if (!map[nameKey]) map[nameKey] = [];
                if (!map[nameKey].includes(row.player_id)) {
                    map[nameKey].push(row.player_id);
                }
            });
        } catch (error) {
            logError('[DB Batch Get IDs]', error, { chunkIndex: i, nameCount: names.length });
        }
    }

    // Collapse multi-ID results into the most stable ID (heuristic)
    Object.keys(map).forEach(name => {
        // Return only the most stable ID (shortest or first seen)
        // For the scraper's purpose, we just need ONE consistent ID
        map[name] = map[name].sort((a, b) => b.length - a.length)[0];
    });

    return map;
}

// ============================================================================
// Player Stats
// ============================================================================

/**
 * Returns a bound statement for the historical ranks lookup.
 */
export function getPlayerHistoricalRanksDeepStmt(db, playerId, dates) {
    if (!dates || dates.length === 0) return null;

    const placeholders = dates.map(() => '?').join(',');
    const sql = `
        SELECT date, MIN(rank) as rank, MAX(score) as sp
        FROM PlayerStats
        WHERE player_id IN (
            SELECT player_id FROM PlayerAliases WHERE normalized_name IN (
                SELECT normalized_name FROM PlayerAliases WHERE player_id = ? OR normalized_name = ?
            )
        )
        AND date IN (${placeholders})
        GROUP BY date
        ORDER BY date ASC
    `;

    const normalizedId = playerId.toLowerCase();
    return db.prepare(sql).bind(playerId, normalizedId, ...dates);
}

/**
 * Retrieves historical ranks for a player and all aliases on specific dates.
 */
export async function getPlayerHistoricalRanksDeep(db, playerId, dates) {
    const stmt = getPlayerHistoricalRanksDeepStmt(db, playerId, dates);
    if (!stmt) return [];
    try {
        const { results } = await stmt.all();
        return results || [];
    } catch (error) {
        logError('[DB Historical Ranks Deep]', error, { playerId, dateCount: dates.length });
        return [];
    }
}

/**
 * Retrieves historical ranks for a player on specific dates.
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
 * Returns a bound statement for the stats range lookup.
 */
export function getPlayerStatsRangeDeepStmt(db, playerId, start, end) {
    const sql = `
        SELECT date, MIN(rank) as rank, MAX(score) as score 
        FROM PlayerStats 
        WHERE player_id IN (
            SELECT player_id FROM PlayerAliases WHERE normalized_name IN (
                SELECT normalized_name FROM PlayerAliases WHERE player_id = ? OR normalized_name = ?
            )
        )
        AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
    `;

    const normalizedId = playerId.toLowerCase();
    return db.prepare(sql).bind(playerId, normalizedId, start, end);
}

/**
 * Retrieves daily stats for a player and all aliases within a date range.
 */
export async function getPlayerStatsRangeDeep(db, playerId, start, end) {
    const stmt = getPlayerStatsRangeDeepStmt(db, playerId, start, end);
    try {
        const { results } = await stmt.all();
        return results || [];
    } catch (error) {
        logError('[DB Stats Range Deep]', error, { playerId, start, end });
        return [];
    }
}

/**
 * Retrieves daily stats for a player within a date range.
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

