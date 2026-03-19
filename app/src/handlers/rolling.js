/**
 * Rolling SP Tracking Handler
 * 
 * Manages high-resolution SP tracking over a rolling 24-hour window.
 * Stores data in a single KV key as an optimized matrix of [sp, rank] pairs.
 * 
 * NOTE: Switched to Name-based tracking due to removal of Player IDs from API.
 */

import { getLiveLeaderboardData } from './leaderboard.js';
import { ROLLING_HISTORY_KV_KEY, ROLLING_HISTORY_SIZE, ROLLING_HISTORY_FREQUENCY_MINS } from '../config.js';
import { logError } from '../utils/errors.js';

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
        // 1. Fetch current top 1000
        const { map: liveMap } = await getLiveLeaderboardData();

        // 2. Load existing history from KV
        const rawHistory = await env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' });
        const matrix = rawHistory || { players: {} };

        // --- MIGRATION: Convert ID-based keys to Name-based keys ---
        // We do this by checking if any key in the matrix is an ID found in the current live map
        for (const [pid, entry] of liveMap.entries()) {
            if (matrix.players[pid] && pid !== entry.name) {
                // If we have history for this ID but no history for this Name yet, migrate it
                if (!matrix.players[entry.name]) {
                    matrix.players[entry.name] = matrix.players[pid];
                }
                // Stop tracking the ID explicitly
                delete matrix.players[pid];
            }
        }

        // 3. Update matrix for each player name present in either live data or history
        const allPlayerNames = new Set([
            ...Object.keys(matrix.players),
            ...Array.from(liveMap.values()).map(p => p.name)
        ]);

        // Create a map of name -> liveEntry for quick lookup
        const liveNameMap = new Map();
        for (const entry of liveMap.values()) {
            // In case of duplicates, keep the one with the better rank
            if (!liveNameMap.has(entry.name) || entry.rank < liveNameMap.get(entry.name).rank) {
                liveNameMap.set(entry.name, entry);
            }
        }

        for (const name of allPlayerNames) {
            // Skip any remaining legacy IDs that didn't match current live players
            if (name.includes('-') && !liveNameMap.has(name)) {
                // This looks like a legacy ID (e.g. rank-123 or a long hex ID)
                // If it's not on the current leaderboard, let it die
                delete matrix.players[name];
                continue;
            }

            const history = matrix.players[name] || [];
            const liveEntry = liveNameMap.get(name);

            // Append new data point: [sp, rank] or null
            if (liveEntry) {
                history.push([liveEntry.score, liveEntry.rank]);
            } else {
                history.push(null);
            }

            // Prune to history size
            if (history.length > ROLLING_HISTORY_SIZE) {
                history.shift();
            }

            // Cleanup: If player has been out of top 1000 for full window, delete them
            const isFullyNull = history.every(v => v === null);
            if (isFullyNull) {
                delete matrix.players[name];
            } else {
                matrix.players[name] = history;
            }
        }

        // 4. Save back to KV
        await env.MARVEL_SNAP_HUB.put(ROLLING_HISTORY_KV_KEY, JSON.stringify(matrix));

        console.log(`[Rolling Scraper] Success: Updated 24h history for ${Object.keys(matrix.players).length} player names`);

    } catch (error) {
        logError('[Rolling Scraper]', error);
    }
}

// ============================================================================
// API Handlers & Helpers
// ============================================================================

/**
 * Helper to resolve a player target (Name) against the rolling matrix.
 */
async function resolvePlayer(target, matrix) {
    if (!target || !matrix || !matrix.players) return { error: 'Invalid data' };

    // 1. Direct O(1) Lookup (Most common case - exact case match)
    if (matrix.players[target]) {
        return { playerName: target };
    }

    const searchName = target.toLowerCase();
    const playerNames = Object.keys(matrix.players);
    
    // 2. Case-insensitive Exact Match
    const exactCaseInsensitive = playerNames.find(name => name.toLowerCase() === searchName);
    if (exactCaseInsensitive) {
        return { playerName: exactCaseInsensitive };
    }

    // 3. Fuzzy match check (includes)
    // Only perform this more expensive scan if exact matches failed
    const matches = playerNames
        .filter(name => name.toLowerCase().includes(searchName))
        .sort((a, b) => a.length - b.length);

    if (matches.length > 1) {
        const list = matches.slice(0, 5).join(', ');
        return { error: truncate(`${list}. Specify unique name.`) };
    } else if (matches.length === 1) {
        return { playerName: matches[0] };
    }

    return { error: `Player "${target}" not found in recent history.` };
}

/**
 * GET /api/leaderboard/rolling
 */
export async function handleGetRollingHistory(c) {
    try {
        const name = c.req.query('name');
        const id = c.req.query('id'); // Support existing profile links using 'id'
        const target = name || id;
        
        const history = await c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' });
        const matrix = history || { players: {} };
        
        if (target) {
            // Check for exact matching or fuzzy match
            const { playerName, error } = await resolvePlayer(target, matrix);
            if (error) {
                return c.json({ playerHistory: [] });
            }
            return c.json({
                playerHistory: matrix.players[playerName] || []
            });
        }

        return c.json(matrix);
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
        const historyData = await c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' });
        const matrix = historyData || { players: {} };

        const { error, playerName } = await resolvePlayer(q, matrix);
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
        const historyData = await c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' });
        const matrix = historyData || { players: {} };

        const { error, playerName } = await resolvePlayer(target, matrix);
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
