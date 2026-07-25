/**
 * Player Profile Handlers
 * 
 * Handles player-related API endpoints including:
 * - Player search with name history
 * - Player profile data retrieval
 * - Season stats and historical rankings
 * - Twitch bot integration (!whois command)
 */

import {
    searchPlayers,
    getPlayerHistory,
    getPlayerHistoryDeep,
    getPlayerHistoryDeepStmt,
    getPlayerStatsRange,
    getPlayerStatsRangeDeep,
    getPlayerStatsRangeDeepStmt,
    getPlayerRollingHistoryRangeDeepStmt,
    batchGetPlayerHistories,
    getPlayerHistoricalRanks,
    getPlayerHistoricalRanksDeep,
    getPlayerHistoricalRanksDeepStmt,
    batchGetIdsByNames
} from '../utils/db.js';
import { getCurrentSeason, getSeasonStart, getSeasonEnd } from '../utils/seasons.js';
import { getHistoricalSeasonEndKeys } from './history.js';
import { getLiveLeaderboardData } from '../utils/live-data.js';
import { logError } from '../utils/errors.js';

import { errorResponse, notFoundResponse, badRequestResponse } from '../utils/response.js';
import {
    SEARCH_RESULT_LIMIT_DEFAULT,
    ERROR_MESSAGES,
    ROLLING_COLLISIONS_KV_KEY
} from '../config.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extracts the most recent name from a player's history array.
 * 
 * @param {Array<{name: string, seenAt: string}>} history - Player name history
 * @returns {string} Most recent player name or "Unknown"
 */
function getCurrentNameFromHistory(history) {
    if (!history || history.length === 0) return null;
    // Database query already returns history ordered chronologically (ASC)
    return history[history.length - 1].name || null;
}

/**
 * Formats a list of players into a concise comma-separated string.
 * 
 * Used for Twitch bot responses. Truncates output to fit within
 * Twitch's message length limits (~400 characters).
 * 
 * @param {Array<Object>} players - Array of player objects
 * @returns {string} Formatted player list
 */
function formatSearchTextOutput(players) {
    if (!players || players.length === 0) {
        return 'No players found.';
    }

    const MAX_LENGTH = 400;
    const outputParts = [];
    let currentLength = 0;

    for (const p of players) {
        let nameStr = p.name;

        // Add current rank if available
        if (p.currentRank) {
            nameStr = `#${p.currentRank} ${nameStr}`;
        }

        // Add aliases (previous names) if available
        if (p.history && p.history.length > 1) {
            // Filter out the current name to find unique aliases 
            // and reverse to show MOST RECENT first (matching web UI)
            const uniqueAliases = [...new Set(
                [...p.history].reverse().map(h => h.name).filter(n => n !== p.name)
            )];

            if (uniqueAliases.length > 0) {
                nameStr += ` (aka ${uniqueAliases.join(', ')})`;
            }
        }

        // Check if adding this entry would exceed the limit
        if (currentLength + nameStr.length + 5 > MAX_LENGTH) {
            outputParts.push('...');
            break;
        }

        outputParts.push(nameStr);
        currentLength += nameStr.length + 2; // +2 for ", "
    }

    return outputParts.join(', ');
}

// ============================================================================
// API Handlers
// ============================================================================

/**
 * GET /api/players/search
 * 
 * Searches for players by name and returns enriched results with:
 * - Current name and rank (from live leaderboard)
 * - Name history (all known aliases)
 * - Player ID for profile links
 * 
 * Supports two output formats:
 * - JSON (default): Full player data for web UI
 * - Text: Concise format for Twitch bot (!whois command)
 * 
 * @param {Object} c - Hono context
 * @param {Object} c.req.query - Query parameters
 * @param {string} c.req.query.q - Search query (min 2 chars)
 * @param {string} [c.req.query.format] - Output format ('text' or 'json')
 * @param {string} [c.req.query.limit] - Max results (default 20)
 * @returns {Promise<Response>} JSON or text response with player matches
 */
export async function handlePlayerHistory(c) {
    const q = c.req.query('q');
    const format = c.req.query('format');
    const limitParam = c.req.query('limit');

    // Return early if no query
    if (!q || !q.trim()) {
        if (format === 'text') {
            return c.text(ERROR_MESSAGES.QUERY_TOO_SHORT);
        }
        return badRequestResponse(c, 'Query required');
    }

    const limit = Math.min(parseInt(limitParam) || SEARCH_RESULT_LIMIT_DEFAULT, 100);
    const db = c.env.DB;

    try {
        // 1. Search in FTS5 index
        const rawResults = await searchPlayers(db, q, limit);

        // 2. Fetch live leaderboard for current ranks AND to find "newer" names
        const { map: liveMap } = await getLiveLeaderboardData();

        // 3. Search live leaderboard for names matching the query
        const liveMatches = [];
        const normalizedQ = q.toLowerCase();
        for (const [id, entry] of liveMap.entries()) {
            if (entry.name.toLowerCase().includes(normalizedQ)) {
                liveMatches.push({
                    id: id,
                    name: entry.name,
                    liveEntry: entry
                });
            }
        }

        // 4. Merge results and deduplicate by Current Owner to separate different players with shared names
        const finalResultsMap = new Map();
        
        // Helper to find the "identity key" for a result
        const getIdentityKey = async (resName, resId) => {
            const { results: owner } = await db.prepare(`
                SELECT id FROM Players WHERE TRIM(normalized_name) = ?
            `).bind(resName.toLowerCase().trim()).all();
            
            // If the name is currently owned by someone (like a UUID), use that as the key
            if (owner && owner.length > 0) return owner[0].id;
            // Otherwise, the ID itself is the identity
            return resId;
        };

        // Process all results (DB + Live)
        const combinedRaw = [
            ...rawResults.map(r => ({ ...r, source: 'db' })),
            ...liveMatches.map(m => ({ ...m, source: 'live' }))
        ];

        for (const r of combinedRaw) {
            const idKey = await getIdentityKey(r.name, r.id);
            const existing = finalResultsMap.get(idKey);
            
            // Resolve the current display identity for this person
            const { results: ownerInfo } = await db.prepare(`
                SELECT name FROM Players WHERE id = ?
            `).bind(idKey).all();
            const currentName = ownerInfo?.[0]?.name || r.name;
            
            // The display ID should be the current name for pretty URLs
            const displayId = currentName;

            const useNew = !existing || (displayId.length > (existing.id?.length || 0));
            if (useNew) {
                finalResultsMap.set(idKey, {
                    id: displayId,
                    realId: idKey,
                    name: r.name, // Keep the matched name for context
                    source: r.source,
                    liveEntry: r.liveEntry || existing?.liveEntry,
                    currentName: currentName
                });
            }
        }

        const uniqueResults = Array.from(finalResultsMap.values()).slice(0, limit);

        // 5. Fetch name history for all matched players
        const playerIds = uniqueResults.map(p => p.realId || p.id);
        const historyMap = await batchGetPlayerHistories(db, playerIds);

        // 6. Enrich results with history and live data
        const enrichedResults = [];
        for (const p of uniqueResults) {
            const history = historyMap[p.realId || p.id] || [];
            let currentName = p.name;
            let currentRank = null;

            // Check if player is on live leaderboard (either from liveMatch or liveMap check)
            if (p.liveEntry) {
                currentName = p.liveEntry.name;
                currentRank = p.liveEntry.rank;
            } else if (liveMap.has(p.id)) {
                const liveEntry = liveMap.get(p.id);
                currentName = liveEntry.name;
                currentRank = liveEntry.rank;
            } else {
                // Fallback to latest in history if not live
                currentName = getCurrentNameFromHistory(history) || p.name;
            }

            // Ensure current name is in history if missing (for "new" players or very recent changes)
            const historyNames = new Set(history.map(h => h.name));
            if (!historyNames.has(currentName)) {
                history.push({ name: currentName, seenAt: new Date().toISOString().split('T')[0] });
            }

            enrichedResults.push({
                id: p.id, // This is the 'displayId' (currentName)
                name: currentName,
                currentRank: currentRank,
                history: history
            });
        }

        // Return appropriate format
        if (format === 'text') {
            const textOutput = formatSearchTextOutput(enrichedResults);
            return c.text(textOutput);
        }

        return c.json({ matches: enrichedResults });

    } catch (error) {
        logError('[Player Search]', error, { query: q, limit });

        if (format === 'text') {
            return c.text('Search error. Please try again.');
        }
        return errorResponse(c, ERROR_MESSAGES.FETCH_FAILED);
    }
}

/**
 * GET /api/players/:id
 * 
 * Retrieves comprehensive profile data for a player including:
 * - Current name and rank
 * - Name history (all aliases)
 * - Daily stats for the selected season
 * - Historical season-end rankings
 * 
 * @param {Object} c - Hono context
 * @param {Object} c.req.param - URL parameters
 * @param {string} c.req.param.id - Player ID
 * @param {Object} c.req.query - Query parameters
 * @param {string} [c.req.query.month] - Target month (1-12)
 * @param {string} [c.req.query.year] - Target year (YYYY)
 * @returns {Promise<Response>} JSON response with player profile data
 */
export async function handleGetPlayerProfile(c) {
    let id = c.req.param('id');
    const qMonth = c.req.query('month');
    const qYear = c.req.query('year');

    // Check player ID exists
    if (!id || !id.trim()) {
        return badRequestResponse(c, ERROR_MESSAGES.NO_PLAYER_ID);
    }

    const db = c.env.DB;

    try {
        // Resolve Name to ID if needed (Current Name Ownership)
        // If the ID is not a UUID (i.e. it's a display name), find the current owner
        const isLikelyName = id.length < 30 && !/^[0-9a-fA-F-]+$/.test(id);
        const normalizedInput = id.toLowerCase();
        let queryIds = [id];
        let primaryId = id;

        if (isLikelyName) {
            // 1. Resolve Name -> Current Owner (UUID or Name-ID)
            const { results: owners } = await db.prepare(`
                SELECT id, name FROM Players WHERE TRIM(normalized_name) = ?
            `).bind(normalizedInput).all();

            if (owners && owners.length > 0) {
                primaryId = owners[0].id;
                queryIds = [id, ...owners.map(o => o.id)];
            } else {
                // 2. Check for Modern Stats before falling back to aliases
                // If the name ALREADY has recent stats, don't bridge to a legacy UUID
                const { results: modernStats } = await db.prepare(`
                    SELECT COUNT(*) as count FROM PlayerStats 
                    WHERE player_id = ? AND date > date('now', '-30 days')
                `).bind(id).all();

                if (modernStats?.[0]?.count === 0) {
                    // Fallback only if no modern stats exist
                    const { results: fallback } = await db.prepare(`
                        SELECT player_id as id FROM PlayerAliases 
                        WHERE TRIM(normalized_name) = ? 
                        ORDER BY first_seen_at DESC LIMIT 1
                    `).bind(normalizedInput).all();
                    if (fallback && fallback.length > 0) {
                        primaryId = fallback[0].id;
                        queryIds = [primaryId, id];
                    }
                }
            }
        }

        // 3. Recursive Bridging: If we found a UUID, find ITS current name to catch name-based stats
        const finalPrimaryId = primaryId;
        if (finalPrimaryId.length >= 28 || /^[0-9a-fA-F-]+$/.test(finalPrimaryId)) {
            const { results: current } = await db.prepare(`
                SELECT name FROM Players WHERE id = ?
            `).bind(finalPrimaryId).all();
            if (current && current.length > 0) {
                const currentName = current[0].name;
                if (currentName && currentName !== finalPrimaryId) {
                    queryIds.push(currentName);
                }
            }
        }

        // Deduplicate query IDs
        queryIds = [...new Set(queryIds.filter(Boolean))];
        primaryId = finalPrimaryId;

        // Determine which season's stats to fetch
        let targetDate;
        if (qMonth && qYear) {
            targetDate = new Date(Date.UTC(parseInt(qYear), parseInt(qMonth) - 1, 15));
        } else {
            // Default to current active season
            const { year, month } = getCurrentSeason(new Date());
            targetDate = new Date(Date.UTC(year, month - 1, 15));
        }

        // Calculate season boundaries
        const seasonStart = getSeasonStart(targetDate);
        const seasonEnd = getSeasonEnd(seasonStart);

        // Skip the first day (season reset day) as it contains previous season data
        const chartStart = new Date(seasonStart);
        chartStart.setUTCDate(chartStart.getUTCDate() + 1);

        const startDateStr = chartStart.toISOString().split('T')[0];
        const endDateStr = seasonEnd.toISOString().split('T')[0];

        // Prepare historical season end dates
        const historicalKeys = getHistoricalSeasonEndKeys();
        const historicalDates = historicalKeys.map(k => k.date);

        // 1. Prepare D1 statements for batching
        const stmtHistory = getPlayerHistoryDeepStmt(db, queryIds);
        const stmtStats = getPlayerStatsRangeDeepStmt(db, queryIds, startDateStr, endDateStr);
        const stmtRolling = getPlayerRollingHistoryRangeDeepStmt(db, queryIds, startDateStr, endDateStr);
        const stmtRanks = getPlayerHistoricalRanksDeepStmt(db, queryIds, historicalDates);
        
        // 4. Theoretical Overlap Detection (Same-Day Collision)
        // We use a subquery to find if multiple IDs for this name were active on the SAME day.
        const stmtOverlap = db.prepare(`
            SELECT COUNT(*) as overlapDays
            FROM (
                SELECT s.date
                FROM PlayerStats s
                JOIN PlayerAliases a ON s.player_id = a.player_id
                WHERE a.normalized_name = (SELECT normalized_name FROM Players WHERE id = ?)
                AND s.date > date('now', '-30 days')
                GROUP BY s.date
                HAVING COUNT(DISTINCT s.player_id) > 1
            )
        `).bind(primaryId);

        // 2. Execute Batch D1 and Live Data concurrently
        const [batchResults, { map: liveMap }, collisionsRaw] = await Promise.all([
            db.batch([stmtHistory, stmtStats, stmtRolling, stmtRanks, stmtOverlap].filter(Boolean)),
            getLiveLeaderboardData(),
            c.env.MARVEL_SNAP_HUB.get(ROLLING_COLLISIONS_KV_KEY, { type: 'json' })
        ]);

        const collisions = collisionsRaw || {};
        
        // Unpack batch results (careful with ordering if some stmts were filtered)
        // Since we know all 4 are returned for a valid target, we can unpack directly
        let history = batchResults[0]?.results || [];
        const d1Stats = batchResults[1]?.results || [];
        const d1Rolling = batchResults[2]?.results || [];
        const d1HistoricalResults = batchResults[3]?.results || [];

        // Format current season stats for frontend
        const currentSeasonStats = d1Stats.map(s => ({
            date: s.date,
            rank: s.rank,
            sp: s.score
        }));

        // Format historical season-end rankings
        const historicalRanks = d1HistoricalResults.map(r => {
            const keyInfo = historicalKeys.find(k => k.date === r.date);
            return {
                season: keyInfo ? keyInfo.seasonName : r.date,
                rank: r.rank,
                sp: r.sp
            };
        });

        // Determine current name from history
        const currentName = getCurrentNameFromHistory(history) || (primaryId.length < 30 ? primaryId : "Unknown");

        // Get live stats if player is on current leaderboard
        let currentRank = null;
        let currentSP = null;
        let finalName = currentName;

        // Try all query IDs in liveMap
        let liveData = null;
        for (const qId of queryIds) {
            liveData = liveMap.get(qId);
            if (liveData) break;
        }
        
        // If not found by ID, and any ID looks like a name, try searching liveMap by name
        if (!liveData) {
            for (const qId of queryIds) {
                if (qId.length < 30) {
                    const normalizedId = qId.toLowerCase();
                    for (const entry of liveMap.values()) {
                        if (entry.name.toLowerCase() === normalizedId) {
                            liveData = entry;
                            break;
                        }
                    }
                }
                if (liveData) break;
            }
        }

        if (liveData) {
            currentRank = liveData.rank;
            currentSP = liveData.score;
            finalName = liveData.name;

            // Proactively add live name to history if it's missing (newer than last scrape)
            const safeHistory = history || [];
            const historyNames = new Set(safeHistory.map(h => h.name));
            if (!historyNames.has(finalName)) {
                safeHistory.push({
                    name: finalName,
                    seenAt: new Date().toISOString().split('T')[0]
                });
            }
            history = safeHistory;
        }

        // Return 404 only if player has absolutely no data
        if (!history || (history.length === 0 && !liveData && currentSeasonStats.length === 0)) {
            return notFoundResponse(c, ERROR_MESSAGES.PLAYER_NOT_FOUND);
        }

        // 3. Collision Check (Live KV + Historical Overlap)
        const d1OverlapResults = batchResults[4]?.results?.[0] || { overlapDays: 0 };
        const isCollision = !!collisions[finalName.toLowerCase()] || (d1OverlapResults.overlapDays > 0);

        return c.json({
            id: primaryId,
            name: finalName,
            currentRank,
            currentSP,
            history: history || [],
            currentSeasonStats,
            seasonRollingStats: d1Rolling, // Raw JSON strings from D1
            historicalSeasonRanks: historicalRanks,
            isCollision: isCollision
        });

    } catch (error) {
        logError('[Player Profile]', error, { playerId: id, month: qMonth, year: qYear });
        return errorResponse(c, ERROR_MESSAGES.FETCH_FAILED);
    }
}

