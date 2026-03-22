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
    ROLLING_HISTORY_SIZE,
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

    if (liveLeaderboardCache && now - liveLeaderboardCache.timestamp < LIVE_LEADERBOARD_CACHE_TTL_MS) {
        const c = liveLeaderboardCache;
        return { map: c.data, total: c.total, collisions: c.collisions };
    }

    const { year, month } = getCurrentSeason(new Date());
    const apiUrl = getLeaderboardApiUrl(month, year);

    try {
        const res = await fetch(apiUrl);

        if (!res.ok) {
            logError('[Leaderboard]', new Error(`API returned ${res.status}`));
            const c = liveLeaderboardCache || { data: new Map(), total: 0, collisions: new Set() };
            return { map: c.data, total: c.total, collisions: c.collisions };
        }

        const data = await res.json();
        const newMap = new Map();
        const collisions = new Set();
        const seenNames = new Set();

        if (data?.results) {
            data.results.forEach((entry, index) => {
                const rank = index + 1;
                const name = entry.playerName || entry.name;
                let id = String(entry.id || entry.playerId || '');
                
                // Track collisions (names that appear more than once)
                if (name) {
                    if (seenNames.has(name)) {
                        collisions.add(name);
                    }
                    seenNames.add(name);
                }

                // Fallback to name-based ID if real ID is missing to prevent Map collision
                if (!id || id === 'undefined' || id === '') {
                    id = name;
                }

                // If collision exists, the Map will naturally keep the LAST one processed
                // but we'll have marked the name as a collision for downstream logic.
                newMap.set(id, {
                    id,
                    rank,
                    name,
                    score: entry.score
                });
            });
        }

        const globalTotal = data?.total || 0;
        liveLeaderboardCache = { timestamp: now, data: newMap, total: globalTotal, collisions };

        return { map: newMap, total: globalTotal, collisions };
    } catch (error) {
        logError('[Leaderboard]', error, { apiUrl });
        // Return stale cache on error
        const c = liveLeaderboardCache || { data: new Map(), total: 0, collisions: new Set() };
        return { map: c.data, total: c.total, collisions: c.collisions };
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

            // Create a name-based lookup for current live players
            const liveNameMap = new Map();
            for (const p of liveMap.values()) {
                liveNameMap.set(p.name, p);
            }

            // 1. Calculate Gainers (Those in rolling history)
            const collisions = rollingRaw?.collisions || {};

            for (const [name, history] of Object.entries(rollingPlayers)) {
                // EXCLUSION: If this name is a known collision, skip it for movers
                if (collisions[name]) continue;

                const liveEntry = liveNameMap.get(name);
                if (!liveEntry) continue;

                // For gainer delta/sparkline, we use the oldest available non-null entry
                const oldestEntry = history.find(e => e !== null);
                if (oldestEntry) {
                    const [oldSP, oldRank] = oldestEntry;
                    const diff = liveEntry.score - oldSP;

                    movers.push({
                        name: liveEntry.name,
                        id: liveEntry.id,
                        change: diff,
                        spStart: oldSP,
                        spEnd: liveEntry.score,
                        rank: liveEntry.rank
                    });
                }
            }

            // 2. Identify "New on Board" (New names in Top 1000)
            const newOnBoard = [];
            for (const p of liveMap.values()) {
                const history = rollingPlayers[p.name];
                
                // A player is "new" if they were not in the Top 1000 at the START of the 24h window.
                // If they have less than ROLLING_HISTORY_SIZE snapshots, they appeared mid-window.
                // If they have full snapshots but the first one is null, they were out at the start.
                const isTrulyNew = !history || 
                                   history.length < ROLLING_HISTORY_SIZE || 
                                   history[0] === null;

                if (isTrulyNew) {
                    newOnBoard.push({
                        name: p.name,
                        id: p.id,
                        rank: p.rank,
                        score: p.score,
                        isNew: true
                    });
                }
            }
            newOnBoard.sort((a, b) => a.rank - b.rank);

            // Sort by change (descending)
            movers.sort((a, b) => b.change - a.change);

            return c.json({
                topGainers: movers.filter(m => m.change > 0).slice(0, TOP_MOVERS_LIMIT),
                newOnBoard: newOnBoard.slice(0, TOP_MOVERS_LIMIT),
                date1: 'rolling',
                date2: 'rolling',
                totalInfinitePlayers: liveTotal
            });
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
        // 1 & 2. Fetch Live Data and Rolling 24h History in parallel for performance
        const [liveData, rollingRaw] = await Promise.all([
            getLiveLeaderboardData(),
            c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' })
        ]);

        const { map, total, collisions } = liveData;
        const rollingPlayers = rollingRaw?.players || {};

        // 3. Build Previous Rank Map from the OLDEST entry in rolling history
        const prevRankMap = new Map();
        if (rollingPlayers && map.size > 0) {
            // Iterate over current live players and find their starting rank in the 24h window
            for (const p of map.values()) {
                const cleanName = (p.name || '').trim();
                const history = rollingPlayers[cleanName];
                // Use the oldest available point in the current window (usually history[0])
                if (history && history.length > 0 && history[0] !== null) {
                    const [sp, rank] = history[0];
                    prevRankMap.set(cleanName, rank);
                }
            }
        }

        // 4. Return results with deltas and "isNew" markers
        const results = Array.from(map.values())
            .sort((a, b) => a.rank - b.rank)
            .map(p => {
                const cleanName = (p.name || '').trim();
                const prevRank = prevRankMap.get(cleanName);
                // A player is "new" if they weren't in the Top 1000 at the START of the 24h window.
                const isNew = !prevRank;
                
                return {
                    id: p.id,
                    rank: p.rank,
                    name: p.name,
                    score: p.score,
                    delta: prevRank ? (prevRank - p.rank) : 0,
                    isNew: isNew
                };
            });

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
 * GET /api/debug/rolling
 * Returns the raw rolling history matrix.
 */
export async function handleGetRollingDebug(c) {
    try {
        const rollingRaw = await c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' });
        return c.json(rollingRaw || { error: 'No rolling history found' });
    } catch (error) {
        return c.json({ error: error.message }, 500);
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
