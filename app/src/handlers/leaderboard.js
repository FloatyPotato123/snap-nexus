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
import { getLiveLeaderboardData } from '../utils/live-data.js';

import { errorResponse, notFoundResponse, badRequestResponse } from '../utils/response.js';
import {
    LIVE_LEADERBOARD_CACHE_TTL_MS,
    TOP_MOVERS_LIMIT,
    ROLLING_HISTORY_KV_KEY,
    ROLLING_HISTORY_SIZE,
    ROLLING_COLLISIONS_KV_KEY,
    getLeaderboardApiUrl,
    ERROR_MESSAGES
} from '../config.js';

const ROLLING_SHARD_COUNT = 10;
const getShardKey = (id) => `${ROLLING_HISTORY_KV_KEY}_shard_${id}`;
const MOVERS_CACHE_KEY = 'leaderboard:movers_cache_v3';


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
        const nowMs = Date.now();
        let liveTotal = 0;
        const movers = [];

        if (type === 'rolling') {
            // 1. Try to fetch from cache first
            const cachedData = await c.env.MARVEL_SNAP_HUB.get(MOVERS_CACHE_KEY, { type: 'json' });
            if (cachedData && (nowMs - cachedData.updatedAt < 300000)) { // 5 minutes cache
                return c.json(cachedData.data);
            }

            // 2. Cache miss: Load all shards + live data
            const shardKeys = Array.from({length: ROLLING_SHARD_COUNT}, (_, i) => getShardKey(i));
            const [shardRaws, liveData, collisionsRaw] = await Promise.all([
                Promise.all(shardKeys.map(k => c.env.MARVEL_SNAP_HUB.get(k, { type: 'json' }))),
                getLiveLeaderboardData(),
                c.env.MARVEL_SNAP_HUB.get(ROLLING_COLLISIONS_KV_KEY, { type: 'json' })
            ]);

            const collisions = collisionsRaw || {};
            liveTotal = liveData.total;
            const liveMap = liveData.map;
            const liveNameMap = new Map();
            for (const p of liveMap.values()) liveNameMap.set(p.name, p);

            // Merge shards
            const rollingPlayers = {};
            for (const s of shardRaws) {
                if (s?.players) Object.assign(rollingPlayers, s.players);
            }

            // Calculate Movers
            for (const [name, history] of Object.entries(rollingPlayers)) {
                if (collisions[name]) continue;
                const liveEntry = liveNameMap.get(name);
                if (!liveEntry) continue;

                const oldestEntry = history.find(e => e !== null);
                if (oldestEntry) {
                    const diff = liveEntry.score - oldestEntry[0];
                    movers.push({
                        name: liveEntry.name,
                        id: liveEntry.id,
                        change: diff,
                        spStart: oldestEntry[0],
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

            // Sort and Split Movers
            movers.sort((a, b) => b.change - a.change);
            const topGainers = movers.filter(m => m.change > 0).slice(0, 100);
            const topLosers = movers.filter(m => m.change < 0).reverse().slice(0, 100);

            // 4. Return and Cache results
            const result = {
                topGainers,
                topLosers,
                newOnBoard: newOnBoard.sort((a, b) => a.rank - b.rank).slice(0, 50),
                total: liveTotal,
                updatedAt: nowMs
            };

            await c.env.MARVEL_SNAP_HUB.put(MOVERS_CACHE_KEY, JSON.stringify({
                updatedAt: nowMs,
                data: result
            }));

            return c.json(result);
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
export async function handleLiveLeaderboard(c) {
    try {
        // 1 & 2. Fetch Live Data and all shards in parallel
        const shardKeys = Array.from({length: ROLLING_SHARD_COUNT}, (_, i) => getShardKey(i));
        const [liveData, shardRaws] = await Promise.all([
            getLiveLeaderboardData(),
            Promise.all(shardKeys.map(k => c.env.MARVEL_SNAP_HUB.get(k, { type: 'json' })))
        ]);

        const { map, total } = liveData;
        
        // Merge shards
        const rollingPlayers = {};
        for (const s of shardRaws) {
            if (s?.players) Object.assign(rollingPlayers, s.players);
        }

        // 3. Build Previous Rank Map from the OLDEST entry in rolling history
        const prevRankMap = new Map();
        if (rollingPlayers && map.size > 0) {
            for (const p of map.values()) {
                const history = rollingPlayers[p.name];
                if (history && history.length > 0) {
                    const oldestEntry = history.find(e => e !== null);
                    if (oldestEntry && oldestEntry[1] !== undefined) {
                        prevRankMap.set(p.name, oldestEntry[1]); // Index 1 is Rank
                    }
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
        console.error('[Live Leaderboard Error]:', error);
        logError('[Live Leaderboard]', error);
        return errorResponse(c, error.message || ERROR_MESSAGES.LEADERBOARD_ERROR);
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


