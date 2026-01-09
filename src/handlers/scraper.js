import { getCurrentSeason, getSeasonStartForMonth } from '../utils/seasons.js';
import { getLeaderboardKey } from '../utils/keys.js';
import { batchUpsertPlayers } from "../utils/db.js";

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

        // 1. Fetch Official Data
        const response = await fetch(LEADERBOARD_API_URL);
        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data = await response.json();
        const leaderboard = data.results || [];

        // 2. Save RAW Snapshot to KV (for historical reference and charts)
        await env.MARVEL_SNAP_HUB.put(DAILY_STORAGE_KEY, JSON.stringify(data));

        // 3. Sync to D1 Search Index
        // This ensures the search identity is up-to-date and all aliases are indexed.
        const seenAt = now.toISOString().split('T')[0];
        const playersToSync = leaderboard
            .filter(p => (p.id || p.playerId) && (p.name || p.playerName))
            .map(p => ({
                id: String(p.id || p.playerId),
                name: p.name || p.playerName
            }));

        if (playersToSync.length > 0) {
            await batchUpsertPlayers(env.DB, playersToSync, seenAt);
        }
    } catch (e) {
        console.error("[Scraper] Error:", e.message);
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
