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
    getPlayerStatsRange,
    batchGetPlayerHistories,
    getPlayerHistoricalRanks
} from '../utils/db.js';
import { getCurrentSeason, getSeasonStart, getSeasonEnd } from '../utils/seasons.js';
import { getHistoricalSeasonEndKeys } from './history.js';
import { getLiveLeaderboardData } from './leaderboard.js';
import { logError } from '../utils/errors.js';

import { errorResponse, notFoundResponse, badRequestResponse } from '../utils/response.js';
import {
    SEARCH_RESULT_LIMIT_DEFAULT,
    ERROR_MESSAGES
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
    if (!history || history.length === 0) return 'Unknown';
    // Database query already returns history ordered chronologically (ASC)
    return history[history.length - 1].name || 'Unknown';
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
            const uniqueAliases = [...new Set(
                p.history.map(h => h.name).filter(n => n !== p.name)
            )];

            if (uniqueAliases.length > 0) {
                nameStr += ` (aka ${uniqueAliases.join(', ')})`;
            }
        }

        // Check if adding this entry would exceed the limit
        if (currentLength + nameStr.length + 2 > MAX_LENGTH) {
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

    const limit = Math.min(parseInt(limitParam) || SEARCH_RESULT_LIMIT_DEFAULT, 50);
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

        // 4. Merge results and deduplicate by player ID
        const finalResultsMap = new Map();

        // Add D1 results first
        for (const r of rawResults) {
            finalResultsMap.set(r.id, {
                id: r.id,
                name: r.name,
                source: 'db'
            });
        }

        // Add live results (they take precedence or add new players)
        for (const m of liveMatches) {
            finalResultsMap.set(m.id, {
                id: m.id,
                name: m.name,
                source: 'live',
                liveEntry: m.liveEntry
            });
        }

        const uniqueResults = Array.from(finalResultsMap.values()).slice(0, limit);

        // 5. Fetch name history for all matched players
        const playerIds = uniqueResults.map(p => p.id);
        const historyMap = await batchGetPlayerHistories(db, playerIds);

        // 6. Enrich results with history and live data
        const enrichedResults = [];
        for (const p of uniqueResults) {
            const history = historyMap[p.id] || [];
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
                id: p.id,
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
    const id = c.req.param('id');
    const qMonth = c.req.query('month');
    const qYear = c.req.query('year');

    // Check player ID exists
    if (!id || !id.trim()) {
        return badRequestResponse(c, ERROR_MESSAGES.NO_PLAYER_ID);
    }

    const db = c.env.DB;

    try {
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

        // Parallel fetch all required data
        const [history, d1Stats, d1HistoricalResults, { map: liveMap }] = await Promise.all([
            getPlayerHistory(db, id),
            getPlayerStatsRange(db, id, startDateStr, endDateStr),
            getPlayerHistoricalRanks(db, id, historicalDates),
            getLiveLeaderboardData()
        ]);

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
        const currentName = getCurrentNameFromHistory(history);

        // Get live stats if player is on current leaderboard
        let currentRank = null;
        let currentSP = null;
        let finalName = currentName;

        if (liveMap.has(id)) {
            const liveData = liveMap.get(id);
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
        }

        // Return 404 only if player has absolutely no data
        if (!history || (history.length === 0 && !liveMap.has(id) && currentSeasonStats.length === 0)) {
            return notFoundResponse(c, ERROR_MESSAGES.PLAYER_NOT_FOUND);
        }

        return c.json({
            id: id,
            name: finalName,
            currentRank,
            currentSP,
            history: history || [],
            currentSeasonStats,
            historicalSeasonRanks: historicalRanks
        });

    } catch (error) {
        logError('[Player Profile]', error, { playerId: id, month: qMonth, year: qYear });
        return errorResponse(c, ERROR_MESSAGES.FETCH_FAILED);
    }
}

