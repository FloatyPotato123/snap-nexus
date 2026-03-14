/**
 * Daily Leaderboard Scraper
 * 
 * Scheduled task that runs daily at 7 PM UTC to:
 * 1. Fetch the latest leaderboard from the official Marvel Snap API
 * 2. Save a snapshot to KV storage for historical reference
 * 3. Update the D1 search index with current player names
 * 4. Record daily stats for charts and analytics
 * 
 * Special handling for season rollover: During the 15-minute buffer window
 * after a new season starts, the scraper captures the previous season's
 * final state instead of the new empty leaderboard.
 */

import { getCurrentSeason, getSeasonStartForMonth } from '../utils/seasons.js';
import { getLeaderboardKey } from '../utils/keys.js';
import { batchUpsertPlayers, recordDailyTotal, recordPlayerStats } from '../utils/db.js';
import { logError } from '../utils/errors.js';
import {
    getLeaderboardApiUrl,
    SEASON_ROLLOVER_BUFFER_MINUTES,
    SEASON_RESET_HOUR_UTC
} from '../config.js';

// ============================================================================
// Main Scraper Function
// ============================================================================

/**
 * Executes the daily leaderboard scrape operation.
 * 
 * This function is called by the Cloudflare Workers cron trigger.
 * It fetches the current leaderboard, stores it in KV, and updates
 * the D1 database with player information and stats.
 * 
 * @param {Object} env - Cloudflare Workers environment bindings
 * @param {Object} env.MARVEL_SNAP_HUB - KV namespace for snapshots
 * @param {Object} env.DB - D1 database instance
 * @returns {Promise<void>}
 */
export async function runDailyScrape(env) {
    const now = new Date();
    let { year: targetYear, month: targetMonth } = getCurrentSeason(now);

    // Handle season rollover edge case
    // During the 15-minute buffer after season reset, capture the previous season
    if (shouldCapturePreviousSeason(now, targetYear, targetMonth)) {
        targetMonth--;
        if (targetMonth < 1) {
            targetMonth = 12;
            targetYear--;
        }
    }

    const storageKey = getLeaderboardKey(now);
    const apiUrl = getLeaderboardApiUrl(targetMonth, targetYear);

    try {
        // Validate environment bindings
        if (!env.MARVEL_SNAP_HUB) {
            throw new Error('MARVEL_SNAP_HUB KV namespace not bound');
        }
        if (!env.DB) {
            throw new Error('DB (D1) not bound');
        }

        // 1. Fetch leaderboard from official API
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }

        const data = await response.json();
        const leaderboard = data.results || [];

        // 2. Save raw snapshot to KV for historical reference
        await env.MARVEL_SNAP_HUB.put(storageKey, JSON.stringify(data));

        // 3. Update D1 search index        // a) Player names for search autocomplete
        // This ensures search results are always up-to-date and aliases are tracked
        const seenAt = now.toISOString().split('T')[0];
        const playersToSync = leaderboard
            .filter(p => {
                const id = p.id || p.playerId;
                return id && id !== 'undefined' && (p.name || p.playerName);
            })
            .map(p => ({
                id: String(p.id || p.playerId),
                name: p.name || p.playerName
            }));

        if (playersToSync.length > 0) {
            await batchUpsertPlayers(env.DB, playersToSync, seenAt);
        }

        // 4. Record daily statistics
        // a) Global infinite player count
        await recordDailyTotal(env.DB, seenAt, data.total || 0);

        // b) Individual player ranks and scores for charts
        const statsEntries = leaderboard
            .map((p, index) => {
                const id = p.id || p.playerId;
                return {
                    playerId: id ? String(id) : null,
                    rank: index + 1,
                    score: p.score
                };
            })
            .filter(s => s.playerId && s.playerId !== 'undefined');

        if (statsEntries.length > 0) {
            await recordPlayerStats(env.DB, seenAt, statsEntries);
        }

        console.log(`[Scraper] Success: Scraped ${leaderboard.length} players for ${seenAt}`);

    } catch (error) {
        logError('[Scraper]', error, {
            targetYear,
            targetMonth,
            apiUrl,
            storageKey
        });
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determines which season's leaderboard to scrape.
 * 
 * During the first 15 minutes after a new season starts (19:00-19:15 UTC),
 * we scrape the PREVIOUS season to capture its final state (end of last day).
 * After the buffer window, we scrape the current season.
 * 
 * @param {Date} now - Current timestamp
 * @param {number} year - Detected current season year
 * @param {number} month - Detected current season month (1-12)
 * @returns {boolean} True if we should scrape the previous season
 */
function shouldCapturePreviousSeason(now, year, month) {
    // Get the start date of the detected "current" season
    // Note: month is 1-indexed from getCurrentSeason, so (month - 1) gives 0-indexed month
    const seasonStart = getSeasonStartForMonth(year, month - 1);

    // Define the reset moment (19:00 UTC on season start day)
    const resetTime = new Date(seasonStart);
    resetTime.setUTCHours(SEASON_RESET_HOUR_UTC, 0, 0, 0);

    // Define the end of the buffer window (19:15 UTC)
    const bufferEnd = new Date(resetTime);
    bufferEnd.setUTCMinutes(SEASON_ROLLOVER_BUFFER_MINUTES);

    // Check if current time is within the buffer window
    return now >= resetTime && now <= bufferEnd;
}

