/**
 * Leaderboard Handlers
 * 
 * Handles leaderboard-related API endpoints including:
 * - Daily snapshot retrieval
 * - Live leaderboard with rank deltas
 * - Leaderboard comparisons (gainers/losers)
 * - Debug endpoints
 */

import { getLeaderboardKey } from '../utils/keys.js';
import { getCurrentSeason } from '../utils/seasons.js';
import { logError } from '../utils/errors.js';

import { errorResponse, notFoundResponse, badRequestResponse } from '../utils/response.js';
import {
    LIVE_LEADERBOARD_CACHE_TTL_MS,
    TOP_MOVERS_LIMIT,
    ROLLING_HISTORY_KV_KEY,
    getLeaderboardApiUrl,
    ERROR_MESSAGES
} from '../config.js';

// ============================================================================
// Cache State
// ============================================================================

/**
 * In-memory cache for live leaderboard data
 * @type {{timestamp: number, data: Map<string, Object>, total: number}}
 */
let liveLeaderboardCache = { timestamp: 0, data: new Map(), total: 0 };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Fetches live Top 1000 ranks and global Infinite total from the official API.
 * Results are cached for 1 minute to reduce API calls.
 * 
 * @returns {Promise<{map: Map<string, {id: string, rank: number, name: string, score: number}>, total: number}>}
 */
export async function getLiveLeaderboardData() {
    const now = Date.now();

    // Always fetch fresh data, cache is only used for error fallback


    const { year, month } = getCurrentSeason(new Date());
    const apiUrl = getLeaderboardApiUrl(month, year);

    try {
        const res = await fetch(apiUrl);

        // If API fails, return stale cache
        if (!res.ok) {
            logError('[Leaderboard]', new Error(`API returned ${res.status}`));
            return { map: liveLeaderboardCache.data, total: liveLeaderboardCache.total };
        }

        const data = await res.json();
        const newMap = new Map();

        if (data?.results) {
            data.results.forEach((entry, index) => {
                const rank = index + 1;
                let id = String(entry.id || entry.playerId || '');
                
                // Fallback to rank-based ID if real ID is missing to prevent Map collision
                if (!id || id === 'undefined' || id === '') {
                    id = `rank-${rank}`;
                }

                newMap.set(id, {
                    id,
                    rank,
                    name: entry.playerName || entry.name,
                    score: entry.score
                });
            });
        }

        const globalTotal = data?.total || 0;
        liveLeaderboardCache = { timestamp: now, data: newMap, total: globalTotal };

        return { map: newMap, total: globalTotal };
    } catch (error) {
        logError('[Leaderboard]', error, { apiUrl });
        // Return stale cache on error
        return { map: liveLeaderboardCache.data, total: liveLeaderboardCache.total };
    }
}

// ============================================================================
// API Handlers
// ============================================================================

/**
 * GET /api/leaderboard/daily
 * 
 * Retrieves a historical daily leaderboard snapshot from KV storage.
 * 
 * @param {Object} c - Hono context
 * @param {Object} c.req.query - Query parameters
 * @param {string} c.req.query.year - Year (YYYY)
 * @param {string} c.req.query.month - Month (MM)
 * @param {string} c.req.query.day - Day (DD)
 * @returns {Promise<Response>} JSON response with leaderboard data
 */
export async function handleLeaderboard(c) {
    const year = c.req.query('year');
    const month = c.req.query('month');
    const day = c.req.query('day');

    if (!year || !month || !day) {
        return badRequestResponse(c, ERROR_MESSAGES.MISSING_DATE_PARAMS);
    }

    // Pad inputs to ensure YYYY-MM-DD format
    const m = month.padStart(2, '0');
    const d = day.padStart(2, '0');
    const dateStr = `${year}-${m}-${d}`;

    // Validate date format
    try {

    } catch (error) {
        return badRequestResponse(c, error.message);
    }

    const key = getLeaderboardKey(dateStr);

    try {
        const data = await c.env.MARVEL_SNAP_HUB.get(key, { type: 'json' });

        if (!data) {
            return notFoundResponse(c, ERROR_MESSAGES.DATA_NOT_FOUND);
        }

        return c.json(data);
    } catch (error) {
        logError('[Leaderboard]', error, { dateStr });
        return errorResponse(c, ERROR_MESSAGES.FETCH_FAILED);
    }
}

/**
 * GET /api/leaderboard/movers
 * 
 * Compares two daily snapshots to calculate rank changes and SP gains/losses.
 * Returns top gainers and top losers.
 * 
 * @param {Object} c - Hono context
 * @param {Object} c.req.query - Query parameters
 * @param {string} c.req.query.date1 - First date (YYYY-MM-DD)
 * @param {string} c.req.query.date2 - Second date (YYYY-MM-DD)
 * @returns {Promise<Response>} JSON response with movers data
 */
export async function handleLeaderboardComparison(c) {
    const type = c.req.query('type');
    const date1Str = c.req.query('date1');
    const date2Str = c.req.query('date2');

    if (type !== 'rolling' && (!date1Str || !date2Str)) {
        return badRequestResponse(c, ERROR_MESSAGES.MISSING_COMPARISON_DATES);
    }

    try {
        let movers = [];
        let liveTotal = 0;

        if (type === 'rolling') {
            const [rollingRaw, liveData] = await Promise.all([
                c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' }),
                getLiveLeaderboardData()
            ]);
            liveTotal = liveData.total;
            const liveMap = liveData.map;
            const rollingPlayers = rollingRaw?.players || {};

            for (const [pid, history] of Object.entries(rollingPlayers)) {
                const liveEntry = liveMap.get(pid);
                if (!liveEntry) continue;

                // Oldest entry in the rolling window (typically 24h ago)
                const oldestEntry = history.find(e => e !== null);
                if (oldestEntry) {
                    const [oldSP, oldRank] = oldestEntry;
                    const diff = liveEntry.score - oldSP;

                    movers.push({
                        name: liveEntry.name,
                        id: pid,
                        change: diff,
                        spStart: oldSP,
                        spEnd: liveEntry.score,
                        rank: liveEntry.rank
                    });
                }
            }
        } else {
            // Original snapshot-based comparison
            const [d1, d2, liveData] = await Promise.all([
                c.env.MARVEL_SNAP_HUB.get(getLeaderboardKey(date1Str), { type: 'json' }),
                c.env.MARVEL_SNAP_HUB.get(getLeaderboardKey(date2Str), { type: 'json' }),
                getLiveLeaderboardData()
            ]);
            liveTotal = liveData.total;

            if (!d1 || !d2) {
                return notFoundResponse(c, 'Data missing for one or both dates.');
            }

            const prevMap = new Map();
            if (d2.results) {
                d2.results.forEach(p => prevMap.set(p.playerId || p.id, p.score));
            }

            if (d1.results) {
                d1.results.forEach(curr => {
                    const pid = curr.playerId || curr.id;
                    const prevScore = prevMap.get(pid);

                    if (prevScore !== undefined) {
                        const diff = curr.score - prevScore;
                        movers.push({
                            name: curr.playerName || curr.name,
                            id: pid,
                            change: diff,
                            spStart: prevScore,
                            spEnd: curr.score,
                            rank: curr.rank || 0
                        });
                    }
                });
            }
        }

        // Sort by change (descending)
        movers.sort((a, b) => b.change - a.change);

        const gainers = movers.filter(m => m.change > 0);
        const losers = movers.filter(m => m.change < 0);

        return c.json({
            topGainers: gainers.slice(0, TOP_MOVERS_LIMIT),
            topLosers: losers.reverse().slice(0, TOP_MOVERS_LIMIT),
            date1: date1Str || 'rolling',
            date2: date2Str || 'rolling',
            totalInfinitePlayers: liveTotal
        });
    } catch (error) {
        logError('[Leaderboard Comparison]', error, { date1Str, date2Str, type });
        return errorResponse(c, ERROR_MESSAGES.FETCH_FAILED);
    }
}

/**
 * GET /api/leaderboard/live
 * 
 * Fetches the current live leaderboard with rank deltas compared to yesterday.
 * 
 * @param {Object} c - Hono context
 * @returns {Promise<Response>} JSON response with live leaderboard and deltas
 */
export async function handleGetLiveLeaderboard(c) {
    try {
        // 1. Fetch Live Data
        const { map, total } = await getLiveLeaderboardData();

        // 2. Fetch Rolling 24h History for comparison
        const rollingRaw = await c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' });
        const rollingPlayers = rollingRaw?.players || {};

        // 3. Build Previous Rank Map from the OLDEST entry in rolling history (24h ago)
        const prevRankMap = new Map();
        for (const [pid, history] of Object.entries(rollingPlayers)) {
            // Find the first non-null entry (the oldest available rank in the 24h window)
            const oldestEntry = history.find(entry => entry !== null);
            if (oldestEntry) {
                const [sp, rank] = oldestEntry;
                prevRankMap.set(pid, rank);
            }
        }

        // 4. Return results without deltas or "isNew" markers (No longer reliable without IDs)
        const results = Array.from(map.values())
            .sort((a, b) => a.rank - b.rank)
            .map(p => ({
                id: p.id,
                rank: p.rank,
                name: p.name,
                score: p.score
            }));

        return c.json({
            results,
            total
        });
    } catch (error) {
        logError('[Live Leaderboard]', error);
        return errorResponse(c, ERROR_MESSAGES.LEADERBOARD_ERROR);
    }
}

/**
 * GET /api/debug/snapshot
 * 
 * Debug endpoint to inspect yesterday's snapshot data.
 * 
 * @param {Object} c - Hono context
 * @returns {Promise<Response>} JSON response with snapshot metadata
 */
export async function handleDebugSnapshot(c) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yKey = getLeaderboardKey(yesterday);

    try {
        const prevData = await c.env.MARVEL_SNAP_HUB.get(yKey, { type: 'json' });

        if (!prevData) {
            return c.json({ error: 'No data for yesterday', key: yKey });
        }

        // Show top 5 raw entries for inspection
        const sample = prevData.results ? prevData.results.slice(0, 5) : [];

        return c.json({
            key: yKey,
            total: prevData.results ? prevData.results.length : 0,
            sample: sample
        });
    } catch (error) {
        logError('[Debug Snapshot]', error, { key: yKey });
        return errorResponse(c, 'Failed to fetch snapshot');
    }
}
