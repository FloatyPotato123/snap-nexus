import { getCurrentSeason, getSeasonStartForMonth } from '../utils/seasons.js';
import { getLeaderboardKey, getPlayerHistoryKey, getPlayerMapKey } from '../utils/keys.js';

const SEASON_ROLLOVER_BUFFER_MINUTES = 15;

export async function runDailyScrape(env) {
    const now = new Date();
    let { year: targetYear, month: targetMonth } = getCurrentSeason(now);

    // Check for season boundary rollover (at 19:00 UTC on season start day).
    // If within buffer window, roll back to capture final snapshot of old season.
    if (shouldCapturePreviousSeason(now, targetYear, targetMonth)) {
        targetMonth--;
        if (targetMonth < 1) { targetMonth = 12; targetYear--; }
    }

    const DAILY_STORAGE_KEY = getLeaderboardKey(now);

    // API URL
    const LEADERBOARD_API_URL = `https://marvelsnap.com/wp-json/api/v1/leaderboard?month=${targetMonth}&year=${targetYear}&region=global`;



    try {
        if (!env.MARVEL_SNAP_HUB) throw new Error("MARVEL_SNAP_HUB binding missing");

        // Fetch Official Data
        const response = await fetch(LEADERBOARD_API_URL);
        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data = await response.json();
        const leaderboard = data.results || [];



        // Save RAW Snapshot
        await env.MARVEL_SNAP_HUB.put(DAILY_STORAGE_KEY, JSON.stringify(data));

        // Process History
        await processNameChanges(env, leaderboard);



    } catch (e) {
        // Silent error in production
    }
}

/**
 * Core Logic for Name Change Detection
 */
async function processNameChanges(env, currentLeaderboard) {
    // Yesterday
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const YESTERDAY_KEY = getLeaderboardKey(d);



    let previousData = [];
    try {
        const rawPrev = await env.MARVEL_SNAP_HUB.get(YESTERDAY_KEY, { type: 'json' });
        if (rawPrev && rawPrev.results) {
            previousData = rawPrev.results;
        }
    } catch (e) {
        return; // First run or missing data, nothing to diff
    }

    // Map ID -> Name for yesterday
    const prevMap = new Map();
    previousData.forEach(p => {
        if (p.id) prevMap.set(p.id, p);
    });

    const writes = []; // Batch promises

    // Iterate TODAY'S leaderboard
    for (const player of currentLeaderboard) {
        if (!player.id) continue;

        const prevPlayer = prevMap.get(player.id);
        const seenAt = new Date().toISOString().split('T')[0];

        // 1. Update Map: Name -> ID
        const cleanName = (player.name || '').trim();
        if (cleanName) {
            const mapKey = getPlayerMapKey(cleanName);
            // Read existing map to append (handling arrays)
            let existingIds = [];
            try {
                const rawMap = await env.MARVEL_SNAP_HUB.get(mapKey, { type: 'json' });
                if (Array.isArray(rawMap)) existingIds = rawMap;
                else if (rawMap) existingIds = [rawMap]; // Legacy support
            } catch (e) { }

            // Add ID if not present
            if (!existingIds.includes(player.id)) {
                existingIds.push(player.id);
                writes.push(env.MARVEL_SNAP_HUB.put(mapKey, JSON.stringify(existingIds)));
            }
        }

        // 2. Check for Name Change or New Entry
        if (!prevPlayer) {
            writes.push(appendHistory(env, player.id, player.name, seenAt));
        } else if (prevPlayer.name !== player.name) {
            writes.push(appendHistory(env, player.id, player.name, seenAt));
        }
    }

    // Wait for all KV writes
    await Promise.all(writes);

}

async function appendHistory(env, id, name, date) {
    const key = getPlayerHistoryKey(id);
    let history = [];

    // Read existing history
    try {
        const raw = await env.MARVEL_SNAP_HUB.get(key, { type: 'json' });
        if (Array.isArray(raw)) history = raw;
    } catch (e) { }

    // Avoid duplicates
    const alreadyExists = history.some(h => h.name === name && h.seenAt === date);
    if (!alreadyExists) {
        history.push({ name, seenAt: date });
        await env.MARVEL_SNAP_HUB.put(key, JSON.stringify(history));
    }
}

/**
 * Checks if we are in the "transition window" (19:00 - 19:15 UTC) of a new season.
 * If true, the scraper should capture the *previous* season's final state instead of the new empty one.
 */
function shouldCapturePreviousSeason(now, year, month) {
    // 1. Get the start date of the detected "Current" (New) season
    // Note: 'month' is 1-indexed from getCurrentSeason, so (month - 1) gives valid 0-indexed month.
    const seasonStart = getSeasonStartForMonth(year, month - 1);

    // 2. Define the Reset Moment (19:00 UTC)
    const resetTime = new Date(seasonStart);
    resetTime.setUTCHours(19, 0, 0, 0);

    // 3. Define the Buffer Window (e.g., 19:00 to 19:15)
    const bufferEnd = new Date(resetTime);
    bufferEnd.setUTCMinutes(SEASON_ROLLOVER_BUFFER_MINUTES);

    return now >= resetTime && now <= bufferEnd;
}
