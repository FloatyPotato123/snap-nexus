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
import { batchUpsertPlayers, recordDailyTotal, recordPlayerStats, batchGetIdsByNames } from '../utils/db.js';
import { logError } from '../utils/errors.js';
import {
    getLeaderboardApiUrl,
    SEASON_ROLLOVER_BUFFER_MINUTES,
    SEASON_RESET_HOUR_UTC,
    ROLLING_HISTORY_KV_KEY
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
    // Ensure seasons cache is loaded in background jobs
    if (!globalThis.SEASONS_CACHE && env.DB) {
        try {
            const { results } = await env.DB.prepare(
                "SELECT season_id, start_date, end_date FROM Seasons ORDER BY start_date ASC"
            ).all();
            if (results && results.length > 0) {
                globalThis.SEASONS_CACHE = results;
            }
        } catch (e) {
            console.error("Scraper failed to load seasons from D1:", e);
        }
    }

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

    // Probe if the NEXT season month has already started early (for rollover detection)
    let nextMonth = targetMonth + 1;
    let nextYear = targetYear;
    if (nextMonth > 12) {
        nextMonth = 1;
        nextYear++;
    }

    const probeUrl = getLeaderboardApiUrl(nextMonth, nextYear);
    let newSeasonDetected = false;
    try {
        const probeRes = await fetch(probeUrl);
        if (probeRes.ok) {
            const probeData = await probeRes.json();
            if (probeData && probeData.results && probeData.results.length > 0) {
                newSeasonDetected = true;
                targetMonth = nextMonth;
                targetYear = nextYear;
                console.log(`Detected early season rollover to ${nextYear}-${nextMonth}`);
            }
        }
    } catch (e) {
        console.error("Scraper failed to probe next season:", e);
    }

    if (newSeasonDetected && env.DB) {
        try {
            const rolloverDate = new Date(now);
            rolloverDate.setUTCHours(19, 0, 0, 0);
            // Rollovers always happen on Tuesday (2)
            while (rolloverDate.getUTCDay() !== 2) {
                rolloverDate.setUTCDate(rolloverDate.getUTCDate() - 1);
            }
            const startDateStr = rolloverDate.toISOString();

            // Estimate end date (First Tuesday of the following month)
            let followingMonth = nextMonth + 1;
            let followingYear = nextYear;
            if (followingMonth > 12) {
                followingMonth = 1;
                followingYear++;
            }
            const estEnd = getSeasonStartForMonth(followingYear, followingMonth - 1);
            estEnd.setUTCHours(19, 0, 0, 0);
            const endDateStr = estEnd.toISOString();

            const newSeasonId = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
            const prevMonth = nextMonth === 1 ? 12 : nextMonth - 1;
            const prevYear = nextMonth === 1 ? nextYear - 1 : nextYear;
            const prevSeasonId = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

            // Insert new season and update previous season's end date
            await env.DB.prepare(
                "INSERT OR IGNORE INTO Seasons (season_id, start_date, end_date) VALUES (?, ?, ?)"
            ).bind(newSeasonId, startDateStr, endDateStr).run();

            await env.DB.prepare(
                "UPDATE Seasons SET end_date = ? WHERE season_id = ?"
            ).bind(startDateStr, prevSeasonId).run();

            // Invalidate server memory cache
            globalThis.SEASONS_CACHE = null;
            console.log(`Successfully registered new season ${newSeasonId} in D1`);
        } catch (e) {
            console.error("Failed to register new season in D1:", e);
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

        // 3. Update D1 Search Index and Player Stats
        // First, fetch existing player IDs for all names to ensure continuity if official IDs are missing
        const allNames = leaderboard.map(p => {
            const n = p.name || p.playerName;
            return n ? n.trim() : null;
        }).filter(Boolean);
        const existingIdMap = await batchGetIdsByNames(env.DB, allNames);

        const seenAt = now.toISOString().split('T')[0];
        
        // a) Player names for search autocomplete
        const playersToSync = leaderboard
            .filter(p => (p.name || p.playerName))
            .map(p => {
                const name = (p.name || p.playerName).trim();
                let id = p.id || p.playerId;
                
                // Fallback: If no official ID, try to reuse an existing ID for this name
                if (!id || id === 'undefined') {
                    id = existingIdMap[name] || name;
                }
                
                return {
                    id: String(id),
                    name: name
                };
            });

        if (playersToSync.length > 0) {
            await batchUpsertPlayers(env.DB, playersToSync, seenAt);
        }

        // 4. Record daily statistics
        // a) Global infinite player count
        await recordDailyTotal(env.DB, seenAt, data.total || 0);

        // b) Individual player ranks and scores for charts
        const statsEntries = leaderboard
            .map((p, index) => {
                const name = (p.name || p.playerName).trim();
                let id = p.id || p.playerId;
                
                if (!id || id === 'undefined') {
                    id = existingIdMap[name] || name;
                }
                
                return {
                    playerId: id ? String(id) : null,
                    rank: index + 1,
                    score: p.score
                };
            })
            .filter(s => s.playerId);

        if (statsEntries.length > 0) {
            await recordPlayerStats(env.DB, seenAt, statsEntries);
        }

        // 5. Archive Rolling 24h Data to D1 (Step Compression)
        try {
            await archiveRollingDataToD1(env, seenAt, existingIdMap, targetYear, targetMonth);
        } catch (archiveErr) {
            console.error('[Scraper] Failed to archive rolling data:', archiveErr);
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

/**
 * Archives the last 24h of rolling KV data to D1 with step compression.
 * Deletes data older than the current season.
 */
async function archiveRollingDataToD1(env, dateStr, existingIdMap, currentYear, currentMonth) {
    const ROLLING_SHARD_COUNT = 10;
    const shardKeys = Array.from({length: ROLLING_SHARD_COUNT}, (_, i) => `${ROLLING_HISTORY_KV_KEY}_shard_${i}`);
    
    const shards = await Promise.all(shardKeys.map(k => env.MARVEL_SNAP_HUB.get(k, { type: 'json' })));
    
    const archiveEntries = [];
    
    for (const shard of shards) {
        if (!shard || !shard.players) continue;
        
        for (const [name, history] of Object.entries(shard.players)) {
            // Find player ID
            const id = existingIdMap[name] || name;
            
            // Step Compression Algorithm
            const compressed = [];
            let lastSP = null;
            
            for (let i = 0; i < history.length; i++) {
                const pt = history[i];
                if (!pt) continue;
                
                const currentSP = pt[0];
                const currentRank = pt[1];
                
                if (currentSP !== lastSP) {
                    // SP changed. Save the point immediately preceding this one (if it exists and wasn't just saved)
                    if (i > 0 && history[i - 1]) {
                        const prev = history[i - 1];
                        // Only add the preceding point if it's not the same index we just processed
                        if (compressed.length === 0 || compressed[compressed.length - 1].t !== (i - 1)) {
                            compressed.push({ t: i - 1, s: prev[0], r: prev[1] });
                        }
                    }
                    
                    // Save the new changed point
                    compressed.push({ t: i, s: currentSP, r: currentRank });
                    lastSP = currentSP;
                } else if (i === 0 || i === history.length - 1) {
                    // Anchor points: Always save the first and last valid points of the day
                    if (compressed.length === 0 || compressed[compressed.length - 1].t !== i) {
                        compressed.push({ t: i, s: currentSP, r: currentRank });
                    }
                }
            }
            
            if (compressed.length > 0) {
                archiveEntries.push({
                    playerId: String(id),
                    date: dateStr,
                    historyJson: JSON.stringify(compressed)
                });
            }
        }
    }
    
    // Batch insert into D1
    if (archiveEntries.length > 0) {
        // Cloudflare D1 limits the number of variables per query (max ~100 bound parameters).
        // A batch of 25 entries has 75 variables, keeping us safely under the limit.
        const BATCH_SIZE = 25; 
        for (let i = 0; i < archiveEntries.length; i += BATCH_SIZE) {
            const batch = archiveEntries.slice(i, i + BATCH_SIZE);
            const placeholders = batch.map(() => '(?, ?, ?)').join(',');
            const values = batch.flatMap(e => [e.playerId, e.date, e.historyJson]);
            
            await env.DB.prepare(
                `INSERT OR REPLACE INTO PlayerRollingHistory (player_id, date, history_json) VALUES ${placeholders}`
            ).bind(...values).run();
        }
        console.log(`[Scraper] Archived rolling data for ${archiveEntries.length} players.`);
    }

    // Cleanup: Delete data older than the current season's start date
    // Note: month is 1-12, getSeasonStartForMonth takes 0-11
    const seasonStart = getSeasonStartForMonth(currentYear, currentMonth - 1);
    seasonStart.setUTCHours(19, 0, 0, 0);
    const seasonStartStr = seasonStart.toISOString().split('T')[0];
    
    const { success, meta } = await env.DB.prepare(
        `DELETE FROM PlayerRollingHistory WHERE date < ?`
    ).bind(seasonStartStr).run();
    
    if (success && meta.changes > 0) {
        console.log(`[Scraper] Cleaned up ${meta.changes} old rolling history records prior to ${seasonStartStr}.`);
    }
}

