/**
 * Rolling SP Tracking Handler
 * 
 * Manages high-resolution SP tracking over a rolling 24-hour window.
 * Stores data in a single KV key as an optimized matrix of [sp, rank] pairs.
 * 
 * NOTE: Switched to Name-based tracking due to removal of Player IDs from API.
 */

import { getLiveLeaderboardData } from '../utils/live-data.js';
import { ROLLING_HISTORY_KV_KEY, ROLLING_HISTORY_SIZE, ROLLING_HISTORY_FREQUENCY_MINS, ROLLING_COLLISIONS_KV_KEY } from '../config.js';
import { logError } from '../utils/errors.js';

// --- SHARDING CONFIG ---
const ROLLING_SHARD_COUNT = 10;
const getShardID = (name) => {
    if (!name) return 0;
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash) % ROLLING_SHARD_COUNT;
};
const getShardKey = (id) => `${ROLLING_HISTORY_KV_KEY}_shard_${id}`;

// ============================================================================
// Scraper Logic
// ============================================================================

/**
 * Executes a high-frequency scrape to update the rolling 24h history.
 * 
 * @param {Object} env - Cloudflare Workers environment bindings
 * @returns {Promise<void>}
 */
export async function runRollingScrape(env) {
    try {
        // 1. Fetch live leaderboard data
        const { map: liveMap, collisions: currentCollisions } = await getLiveLeaderboardData();
        const nowMs = Date.now();
        
        // 2. Fetch all shards + legacy matrix in parallel
        const shardKeys = Array.from({length: ROLLING_SHARD_COUNT}, (_, i) => getShardKey(i));
        const [legacyMatrix, ...shards] = await Promise.all([
            env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' }),
            ...shardKeys.map(key => env.MARVEL_SNAP_HUB.get(key, { type: 'json' }))
        ]);

        // 3. Initialize/Prepare Shards
        const activeShards = shards.map((s, i) => s || { players: {}, updatedAt: 0, shardID: i });
        const collisions = legacyMatrix?.collisions || {};

        // 4. MIGRATION: Move players from legacy matrix into proper shards
        if (legacyMatrix?.players) {
            for (const [name, history] of Object.entries(legacyMatrix.players)) {
                const sid = getShardID(name);
                if (!activeShards[sid].players[name]) {
                    activeShards[sid].players[name] = history;
                }
            }

        }

        // --- UPDATE COLLISIONS ---
        if (currentCollisions && currentCollisions.size > 0) {
            for (const name of currentCollisions) {
                collisions[name.toLowerCase()] = nowMs;
            }
        }
        const collisionExpiry = nowMs - (30 * 24 * 60 * 60 * 1000);
        for (const name in collisions) {
            if (collisions[name] < collisionExpiry) delete collisions[name];
        }

        // 5. Build live name map for easier lookup
        const liveNameMap = new Map();
        for (const entry of liveMap.values()) {
            if (!liveNameMap.has(entry.name) || entry.rank < liveNameMap.get(entry.name).rank) {
                liveNameMap.set(entry.name, entry);
            }
        }

        // 6. Update Players across all shards
        const updatedShardIndices = new Set();
        const allNamesToUpdate = new Set([
            ...activeShards.flatMap(s => Object.keys(s.players)),
            ...Array.from(liveNameMap.keys())
        ]);

        // 5. GLOBAL MIGRATION: Find any old numeric IDs in ALL shards and link them to Names
        // This handles cases where ID and Name map to different shards.
        const idToHistoryMap = new Map();
        for (const shard of Object.values(activeShards)) {
            for (const [key, history] of Object.entries(shard.players)) {
                if (/^\d+$/.test(key)) { // It is a numeric ID
                    idToHistoryMap.set(key, history);
                }
            }
        }

        // 6. Process live players 
        for (const entry of liveMap.values()) {
            const playerName = entry.name;
            if (!playerName) continue;

            const sid = getShardID(playerName);
            const activeShard = activeShards[sid];
            
            let history = activeShard.players[playerName] || new Array(ROLLING_HISTORY_SIZE).fill(null);
            
            // Shift left and add new point
            history.shift();
            history.push([entry.score, entry.rank]);

            if (history.every(v => v === null)) {
                delete activeShard.players[playerName];
            } else {
                activeShard.players[playerName] = history;
            }
            updatedShardIndices.add(sid);
        }

        // 7. CLEANUP: Delete ALL numeric ID keys from ALL shards (Legacy Cleanup)
        for (const [sidStr, shard] of Object.entries(activeShards)) {
            const sid = parseInt(sidStr);
            let shardChanged = false;
            for (const key of Object.keys(shard.players)) {
                if (/^\d+$/.test(key)) {
                    delete shard.players[key];
                    shardChanged = true;
                }
            }
            if (shardChanged) {
                updatedShardIndices.add(sid);
            }
        }

        // 7. Save modified shards back to KV
        const savePromises = [];
        for (const idx of updatedShardIndices) {
            const shard = activeShards[idx];
            shard.updatedAt = nowMs;
            savePromises.push(env.MARVEL_SNAP_HUB.put(getShardKey(idx), JSON.stringify(shard)));
        }

        savePromises.push(env.MARVEL_SNAP_HUB.put(ROLLING_COLLISIONS_KV_KEY, JSON.stringify(collisions)));
        if (legacyMatrix) {
            savePromises.push(env.MARVEL_SNAP_HUB.delete(ROLLING_HISTORY_KV_KEY));
        }

        await Promise.all(savePromises);
        return { success: true };

    } catch (error) {
        logError('[Rolling Scraper]', error);
        return { error: error.message };
    }
}

// ============================================================================
// API Handlers & Helpers
// ============================================================================

/**
 * Helper to resolve a player target (Name) against shards.
 */
async function resolvePlayerInShards(target, env) {
    if (!target) return { error: 'Invalid data' };

    // 1. Try deterministic shard first (Hash lookup)
    const sid = getShardID(target);
    const primaryShard = await env.MARVEL_SNAP_HUB.get(getShardKey(sid), { type: 'json' });
    
    if (primaryShard?.players?.[target]) {
        return { playerName: target, matrix: primaryShard };
    }

    // 2. Case-insensitive exact match in primary shard
    const searchName = target.toLowerCase();
    if (primaryShard?.players) {
        const exactMatch = Object.keys(primaryShard.players).find(n => n.toLowerCase() === searchName);
        if (exactMatch) return { playerName: exactMatch, matrix: primaryShard };
    }

    // 3. Fallback: Search ALL shards (Slow, but only for fuzzy/bad case matches)
    const shardKeys = Array.from({length: ROLLING_SHARD_COUNT}, (_, i) => getShardKey(i));
    const allShards = await Promise.all(shardKeys.map(k => env.MARVEL_SNAP_HUB.get(k, { type: 'json' })));
    
    for (const shard of allShards) {
        if (!shard?.players) continue;
        const playerNames = Object.keys(shard.players);
        
        const exactMatch = playerNames.find(n => n.toLowerCase() === searchName);
        if (exactMatch) return { playerName: exactMatch, matrix: shard };

        const fuzzy = playerNames.find(n => n.toLowerCase().includes(searchName));
        if (fuzzy) return { playerName: fuzzy, matrix: shard };
    }

    return { error: `Player "${target}" not found in recent history.` };
}

/**
 * GET /api/leaderboard/rolling
 */
export async function handleGetRollingHistory(c) {
    try {
        const name = c.req.query('name');
        const id = c.req.query('id'); 
        const target = name || id;

        if (target) {
            const { playerName, matrix, error } = await resolvePlayerInShards(target, c.env);
            if (error) {
                return c.json({ playerHistory: [], updatedAt: 0 });
            }
            return c.json({
                playerHistory: matrix.players[playerName],
                updatedAt: matrix.updatedAt
            });
        }

        // Default: Return all shards merged (Slow, but only used for debugging/internal)
        const shardKeys = Array.from({length: ROLLING_SHARD_COUNT}, (_, i) => getShardKey(i));
        const allShards = await Promise.all(shardKeys.map(k => c.env.MARVEL_SNAP_HUB.get(k, { type: 'json' })));
        
        const merged = { players: {}, updatedAt: 0 };
        for (const s of allShards) {
            if (!s) continue;
            Object.assign(merged.players, s.players);
            if (s.updatedAt > merged.updatedAt) merged.updatedAt = s.updatedAt;
        }
        return c.json(merged);
    } catch (error) {
        logError('[Rolling API]', error);
        return c.json({ error: 'Failed to fetch history' }, 500);
    }
}

/**
 * GET /api/player/playtime
 */
export async function handleGetPlayerPlaytime(c) {
    const q = c.req.query('q');
    if (!q) return c.text("Error: Missing query parameter 'q'");

    try {
        const { playerName, matrix, error } = await resolvePlayerInShards(q, c.env);
        if (error) return c.text(error);

        const history = matrix.players[playerName];
        
        // Calculate playtime: count intervals where SP changed (actual matches played)
        let activePoints = 0;
        for (let i = 1; i < history.length; i++) {
            const prev = history[i - 1];
            const curr = history[i];
            
            // If SP changed between two consecutive points, they played during this interval
            if (prev && curr && prev[0] !== curr[0]) {
                activePoints++;
            }
        }
        
        const totalMins = activePoints * ROLLING_HISTORY_FREQUENCY_MINS;
        
        const validHistory = history.filter(h => h !== null);
        if (validHistory.length === 0) return c.text(`${playerName} has no recent data.`);

        const [startSP, startRank] = validHistory[0];
        const [endSP, endRank] = validHistory[validHistory.length - 1];
        
        const spDelta = endSP - startSP;
        const rankDelta = startRank - endRank;

        const spDeltaStr = spDelta >= 0 ? `+${spDelta}` : `-${Math.abs(spDelta)}`;
        const rankDeltaStr = rankDelta >= 0 ? `+${rankDelta}` : `-${Math.abs(rankDelta)}`;
        const estGames = Math.round(totalMins / 4);

        return c.text(`(24h) | Playtime: >${totalMins}m (>${estGames} games) | SP: ${spDeltaStr} (${startSP} -> ${endSP}) | Rank: ${rankDeltaStr} (#${startRank} -> #${endRank})`);
    } catch (error) {
        logError('[Playtime API]', error);
        return c.text("Error calculating playtime.");
    }
}

/**
 * GET /api/player/sparkline
 */
export async function handleGetPlayerSparkline(c) {
    const q = c.req.query('q');
    const window = c.req.query('window');
    const id = c.req.param('id'); // Support for direct path
    
    const target = q || id;
    if (!target) return c.text("Error: Missing player name");

    try {
        const { playerName, matrix, error } = await resolvePlayerInShards(target, c.env);
        if (error) return c.text(error);

        let history = matrix.players[playerName];
        
        // Apply window slicing if provided
        let windowLabel = "24h";
        if (window) {
            const mins = parseUptime(window);
            const sliceSize = Math.ceil(mins / ROLLING_HISTORY_FREQUENCY_MINS);
            history = history.slice(-sliceSize);
            windowLabel = window.includes('hour') || window.includes('minute') ? window : `${mins}m`;
        }

        const validHistory = history.filter(h => h !== null);
        if (validHistory.length === 0) return c.text(`${playerName}: No data in window.`);

        const spSeries = history.map(h => h ? h[0] : null);

        // 2. Rendering (16-bar sparkline downsampling)
        const BARS = 16;
        const sampled = [];
        const chunkSize = Math.max(1, spSeries.length / BARS);

        for (let i = 0; i < BARS; i++) {
            const start = Math.floor(i * chunkSize);
            const end = Math.floor((i + 1) * chunkSize);
            const chunk = spSeries.slice(start, end).filter(n => n !== null);

            if (chunk.length === 0) {
                sampled.push(null);
            } else {
                const avg = chunk.reduce((a, b) => a + b, 0) / chunk.length;
                sampled.push(avg);
            }
        }

        const spark = renderSparkline(sampled);

        const [startSP, startRank] = validHistory[0];
        const [endSP, endRank] = validHistory[validHistory.length - 1];

        const spDelta = endSP - startSP;
        const rankDelta = startRank - endRank;

        const spDeltaStr = spDelta >= 0 ? `+${spDelta}` : `-${Math.abs(spDelta)}`;
        const rankDeltaStr = rankDelta >= 0 ? `+${rankDelta}` : `-${Math.abs(rankDelta)}`;

        return c.text(`${spark} (${windowLabel}) | SP: ${spDeltaStr} (${startSP} -> ${endSP}) | Rank: ${rankDeltaStr} (#${startRank} -> #${endRank})`);
    } catch (error) {
        logError('[Sparkline API]', error);
        return c.text("Error generating sparkline.");
    }
}

/**
 * Parses Nightbot's $(twitch uptime) string into total minutes.
 */
function parseUptime(str) {
    if (!str || str.toLowerCase().includes('offline')) return 1440;

    let totalMins = 0;
    const hoursMatch = str.match(/(\d+)\s*hour/i);
    const minsMatch = str.match(/(\d+)\s*minute/i);

    if (hoursMatch) totalMins += parseInt(hoursMatch[1]) * 60;
    if (minsMatch) totalMins += parseInt(minsMatch[1]);

    return totalMins > 0 ? totalMins : 5;
}

/**
 * Renders a list of numbers as a Unicode sparkline.
 */
function renderSparkline(numbers) {
    const valid = numbers.filter(n => n !== null);
    if (valid.length === 0) return '';
    
    const ticks = ['▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const range = max - min;

    if (range === 0) return ticks[0].repeat(numbers.length);

    return numbers.map(n => {
        if (n === null) return ' ';
        const index = Math.floor(((n - min) / range) * (ticks.length - 1));
        return ticks[index];
    }).join('');
}

/**
 * Truncates a string to a specific limit.
 */
function truncate(str, limit = 400) {
    if (str.length <= limit) return str;
    return str.substring(0, limit - 3) + "...";
}
