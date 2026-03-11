/**
 * Rolling SP Tracking Handler
 * 
 * Manages high-resolution SP tracking over a rolling 24-hour window.
 * Stores data in a single KV key as an optimized matrix of [sp, rank] pairs.
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

        // 3. Update matrix for each player
        const allPlayerIds = new Set([
            ...Object.keys(matrix.players),
            ...liveMap.keys()
        ]);

        for (const pid of allPlayerIds) {
            const history = matrix.players[pid] || [];
            const liveEntry = liveMap.get(pid);

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
                delete matrix.players[pid];
            } else {
                matrix.players[pid] = history;
            }
        }

        // 4. Save back to KV
        await env.MARVEL_SNAP_HUB.put(ROLLING_HISTORY_KV_KEY, JSON.stringify(matrix));

        console.log(`[Rolling Scraper] Success: Updated 24h history for ${Object.keys(matrix.players).length} players`);

    } catch (error) {
        logError('[Rolling Scraper]', error);
    }
}

// ============================================================================
// API Handlers & Helpers
// ============================================================================

/**
 * Helper to resolve a player target (ID or Name) against the live leaderboard.
 * Handles multiple matches by returning a helpful string of options.
 */
async function resolvePlayer(target, matrix, liveMap) {
    let targetId = target;
    let playerName = target;

    // If direct ID lookup fails in matrix, search by name in live leaderboard
    if (!matrix.players[targetId]) {
        const searchName = target.toLowerCase();
        const matches = Array.from(liveMap.values())
            .filter(p => p.name.toLowerCase().includes(searchName))
            .sort((a, b) => a.rank - b.rank); // Sort by rank for clarity

        if (matches.length > 1) {
            const list = matches.map(p => `${p.name} (#${p.rank}: ${p.id})`).join(', ');
            return { error: truncate(`${list}. Specify unique name or ID`) };
        } else if (matches.length === 1) {
            targetId = matches[0].id;
            playerName = matches[0].name;
        } else {
            return { error: `Player "${target}" not found in current Top 1000.` };
        }
    } else {
        // Found by ID, get the name for the response if available
        playerName = liveMap.get(targetId)?.name || targetId;
    }

    return { targetId, playerName };
}

/**
 * GET /api/leaderboard/rolling
 * 
 * Returns the full 24h rolling history matrix for profiles.
 */
export async function handleGetRollingHistory(c) {
    try {
        const id = c.req.query('id');
        const history = await c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' });
        const matrix = history || { players: {} };

        if (id) {
            return c.json({
                playerHistory: matrix.players[id] || []
            });
        }

        return c.json(matrix);
    } catch (error) {
        logError('[Rolling API]', error);
        return c.json({ error: 'Failed to fetch history' }, 500);
    }
}

/**
 * Concise text response for estimating a player's playtime over the last 24 hours.
 * 
 * URL for Nightbot:
 * !addcom !playtime $(urlfetch https://.../playtime?q=$(query))
 * 
 * Output Example: Dekkster played ~120 mins in last 24h. SP: 9150 ▲150, Rank: #42 ▲5
 */
export async function handleGetPlayerPlaytime(c) {
    const q = c.req.query('q');
    const idParam = c.req.param('id');
    const target = q || idParam;

    if (!target) return c.text('No player specified. Usage: !playtime [name]');

    try {
        const matrix = await c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' });
        if (!matrix) return c.text('No rolling data available yet.');

        const { map: liveMap } = await getLiveLeaderboardData();
        const { targetId, playerName, error } = await resolvePlayer(target, matrix, liveMap);

        if (error) return c.text(error);

        if (!matrix.players[targetId]) {
            return c.text(`No rolling data found for ${playerName} in the last 24h.`);
        }

        const history = [...matrix.players[targetId]];

        // Append live data directly
        const liveEntry = liveMap.get(targetId);
        if (liveEntry) {
            history.push([liveEntry.score, liveEntry.rank]);
        }

        // Statistics
        let activeIntervals = 0;
        let lastSP = null;
        let startSP = null;
        let endSP = null;
        let startRank = null;
        let endRank = null;

        for (const entry of history) {
            if (!entry) {
                lastSP = null; // Reset on dropout
                continue;
            }

            const [sp, rank] = entry;

            // Track start/end for delta
            if (startSP === null) {
                startSP = sp;
                startRank = rank;
            }
            endSP = sp;
            endRank = rank;

            // Detect activity (SP changed compared to last known SP)
            if (lastSP !== null && sp !== lastSP) {
                activeIntervals++;
            }
            lastSP = sp;
        }

        const minsPlayed = activeIntervals * ROLLING_HISTORY_FREQUENCY_MINS;
        const estGames = Math.round(minsPlayed / 4);
        const spDelta = endSP - (startSP || endSP);
        const rankDelta = (startRank || endRank) - endRank;

        const spDeltaStr = spDelta >= 0 ? `+${spDelta}` : `-${Math.abs(spDelta)}`;
        const rankDeltaStr = rankDelta >= 0 ? `+${rankDelta}` : `-${Math.abs(rankDelta)}`;

        return c.text(`(24h) | Playtime: >${minsPlayed}m (>${estGames} games) | SP: ${spDeltaStr} (${startSP} -> ${endSP}) | Rank: ${rankDeltaStr} (#${startRank} -> #${endRank})`);

    } catch (error) {
        logError('[Twitch Playtime API]', error);
        return c.text('Error calculating playtime.');
    }
}

/**
 * Returns a Unicode sparkline (trend graph) for a player.
 * 
 * Resolves player via 'q' (name/ID search) or path 'id', then applies an optional
 * 'window' param (minutes or Nightbot uptime string) to slice the lookback period.
 * If no window is given, defaults to 24h.
 * 
 * Nightbot commands:
 *   !sp     → ?q=$(querystring)
 *   _huskysp → ?q=PLAYER_ID&window=$(querystring)
 * 
 * Output Example: ▂▂▃▅▆▇█ (Last 3h 15m: SP: 9005 ▲23, Rank: #7 ▲1)
 */
export async function handleGetPlayerSparkline(c) {
    const idParam = c.req.param('id');
    const q = c.req.query('q');
    const windowParam = c.req.query('window');

    // Determine target player. Nightbot sometimes passes literal "$(query)" if empty.
    const target = (q && q.trim() !== '' && q !== '$(query)') ? q.trim() : idParam;

    if (!target) return c.text('No player specified. Usage: !sp [name]');

    let lookbackMins = 1440; // Default 24h
    let isSession = false;

    if (windowParam) {
        if (/^\d+$/.test(windowParam)) {
            lookbackMins = parseInt(windowParam);
            isSession = true;
        } else {
            // Parse Nightbot uptime string: "3 hours, 15 minutes" -> 195 mins
            lookbackMins = parseUptime(windowParam);
            isSession = !windowParam.toLowerCase().includes('offline');
        }
    }

    try {
        const matrix = await c.env.MARVEL_SNAP_HUB.get(ROLLING_HISTORY_KV_KEY, { type: 'json' });
        if (!matrix) return c.text('No rolling data available.');

        const { map: liveMap } = await getLiveLeaderboardData();
        const { targetId, playerName, error } = await resolvePlayer(target, matrix, liveMap);

        if (error) return c.text(error);

        const history = [...(matrix.players[targetId] || [])];

        // Append live data directly
        const liveEntry = liveMap.get(targetId);
        if (liveEntry) {
            history.push([liveEntry.score, liveEntry.rank]);
        }

        if (!history || history.length === 0) {
            return c.text(`No 24h data for ${playerName}.`);
        }

        // 1. Core Stats & Time Filtering
        let startSP = null, endSP = null, startRank = null, endRank = null;
        const spSeries = [];
        let spChanged = false;
        let lastSeenSP = null;

        // Matrix has 288 points (5 min each). Calculate how many we need.
        const pointsNeeded = Math.ceil(lookbackMins / ROLLING_HISTORY_FREQUENCY_MINS);
        const filteredHistory = history.slice(-pointsNeeded);

        for (const entry of filteredHistory) {
            if (!entry) {
                if (spSeries.length > 0) spSeries.push(null); // Keep gaps for rendering
                continue;
            }
            const [sp, rank] = entry;
            if (startSP === null) {
                startSP = sp;
                startRank = rank;
            }
            endSP = sp;
            endRank = rank;
            spSeries.push(sp);

            if (lastSeenSP !== null && sp !== lastSeenSP) {
                spChanged = true;
            }
            lastSeenSP = sp;
        }

        if (spSeries.length === 0 || endSP === null) {
            return c.text(`No data for ${playerName} in the requested window.`);
        }

        // 2. Rendering (16-bar sparkline)
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

        const sparkline = renderSparkline(sampled);
        const spDelta = endSP - (startSP || endSP);
        const rankDelta = (startRank || endRank) - endRank;
        
        const spDeltaStr = spDelta >= 0 ? `+${spDelta}` : `-${Math.abs(spDelta)}`;
        const rankDeltaStr = rankDelta >= 0 ? `+${rankDelta}` : `-${Math.abs(rankDelta)}`;

        let durationLabel = "";
        if (isSession) {
            const h = Math.floor(lookbackMins / 60);
            const m = lookbackMins % 60;
            durationLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;
        } else {
            durationLabel = lookbackMins >= 1440 ? "24h" : `${lookbackMins}m`;
        }

        if (!spChanged) {
            return c.text(`(${durationLabel}) | SP: ${spDeltaStr} (${startSP} -> ${endSP}) | Rank: ${rankDeltaStr} (#${startRank} -> #${endRank})`);
        } else {
            return c.text(`${sparkline} (${durationLabel}) | SP: ${spDeltaStr} (${startSP} -> ${endSP}) | Rank: ${rankDeltaStr} (#${startRank} -> #${endRank})`);
        }

    } catch (e) {
        logError('[Twitch Sparkline API]', e);
        return c.text('Error generating trend.');
    }
}

/**
 * Parses Nightbot's $(twitch uptime) string into total minutes.
 * Handles: "3 hours, 15 minutes", "45 minutes", "1 hour", etc.
 */
function parseUptime(str) {
    if (!str || str.toLowerCase().includes('offline')) return 1440;

    let totalMins = 0;
    const hoursMatch = str.match(/(\d+)\s*hour/i);
    const minsMatch = str.match(/(\d+)\s*minute/i);

    if (hoursMatch) totalMins += parseInt(hoursMatch[1]) * 60;
    if (minsMatch) totalMins += parseInt(minsMatch[1]);

    // Safety: if parse fails or stream just started, return at least 5 mins
    return totalMins > 0 ? totalMins : 5;
}

/**
 * Renders a list of numbers as a Unicode sparkline.
 */
function renderSparkline(numbers) {
    if (numbers.length === 0) return '';
    const ticks = ['▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const min = Math.min(...numbers.filter(n => n !== null));
    const max = Math.max(...numbers.filter(n => n !== null));
    const range = max - min;

    if (range === 0) return ticks[ticks.length - 1].repeat(numbers.length);

    return numbers.map(n => {
        if (n === null) return ' '; // Gap in data (leaderboard drop)
        const index = Math.floor(((n - min) / range) * (ticks.length - 1));
        return ticks[index];
    }).join('');
}

/**
 * Truncates a string to a specific limit, adding "..." if needed.
 */
function truncate(str, limit = 400) {
    if (str.length <= limit) return str;
    return str.substring(0, limit - 3) + "...";
}
