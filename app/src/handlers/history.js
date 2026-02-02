/**
 * Historical Data Handlers
 * 
 * Handles endpoints for historical leaderboard data including:
 * - Season-end player totals
 * - Date range queries for daily totals
 * - Legacy data integration
 */

import { getSeasonStart, getSeasonEnd } from '../utils/seasons.js';
import { getLeaderboardKey } from '../utils/keys.js';
import { HISTORICAL_DATA } from '../utils/legacy_data.js';
import { getDailyTotalsRange } from '../utils/db.js';
import { logError } from '../utils/errors.js';

import { badRequestResponse, errorResponse } from '../utils/response.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum number of days allowed in a date range query
 */
const MAX_DATE_RANGE_DAYS = 90;

/**
 * Number of historical seasons to include
 */
const HISTORICAL_SEASONS_COUNT = 6;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generates metadata for the last N season-end dates.
 * 
 * Used to fetch historical season-end rankings and player totals.
 * Returns keys in chronological order (oldest first).
 * 
 * @returns {Array<{key: string, date: string, seasonName: string, seasonMonth: number, seasonYear: number}>}
 */
export function getHistoricalSeasonEndKeys() {
    const keys = [];
    const now = new Date();

    // Go back N months
    for (let i = 1; i <= HISTORICAL_SEASONS_COUNT; i++) {
        const d = new Date(now);
        // Set to middle of month to avoid rollover bugs when today is the 31st
        d.setUTCDate(15);
        d.setUTCMonth(d.getUTCMonth() - i);

        const seasonEnd = getSeasonEnd(d);

        keys.push({
            key: getLeaderboardKey(seasonEnd),
            date: seasonEnd.toISOString().split('T')[0],
            seasonName: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
            seasonMonth: d.getUTCMonth() + 1,
            seasonYear: d.getUTCFullYear()
        });
    }

    return keys.reverse(); // Return in chronological order
}

// ============================================================================
// API Handlers
// ============================================================================

/**
 * GET /api/history/range
 * 
 * Retrieves daily Infinite player totals for a date range.
 * Maximum range is 90 days to prevent excessive queries.
 * 
 * @param {Object} c - Hono context
 * @param {Object} c.req.query - Query parameters
 * @param {string} c.req.query.start - Start date (YYYY-MM-DD)
 * @param {string} c.req.query.end - End date (YYYY-MM-DD)
 * @returns {Promise<Response>} JSON array of daily totals
 */
export async function handleHistoryRange(c) {
    const start = c.req.query('start');
    const end = c.req.query('end');

    if (!start || !end) {
        return badRequestResponse(c, 'Missing start or end date (YYYY-MM-DD)');
    }

    // Validate date formats
    try {

    } catch (error) {
        return badRequestResponse(c, error.message);
    }

    // Calculate date range
    const startDate = new Date(start);
    const endDate = new Date(end);
    const dates = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dates.push(new Date(d));
    }

    // Enforce maximum range limit
    if (dates.length > MAX_DATE_RANGE_DAYS) {
        return badRequestResponse(c, `Date range too large (max ${MAX_DATE_RANGE_DAYS} days)`);
    }

    try {
        // Fetch from D1
        const results = await getDailyTotalsRange(c.env.DB, start, end);
        return c.json(results);
    } catch (error) {
        logError('[History Range]', error, { start, end });
        return errorResponse(c, 'Failed to fetch history');
    }
}

/**
 * GET /api/history/seasons
 * 
 * Retrieves historical season-end player totals.
 * Combines legacy hardcoded data with D1 database records.
 * 
 * Returns data in chronological order with deduplication.
 * 
 * @param {Object} c - Hono context
 * @returns {Promise<Response>} JSON array of season totals
 */
export async function handleSeasonHistory(c) {
    try {
        // 1. Start with legacy hardcoded data (May - Nov 2025)
        let fullHistory = [...HISTORICAL_DATA];

        // 2. Fetch completed seasons from D1
        const historicalKeys = getHistoricalSeasonEndKeys();

        // Fetch total player count for the end date of each season
        const promises = historicalKeys.map(k =>
            getDailyTotalsRange(c.env.DB, k.date, k.date)
                .then(res => ({ key: k, data: res[0] }))
        );

        const d1Results = await Promise.all(promises);

        // 3. Merge D1 results into history
        d1Results.forEach(r => {
            if (r.data && r.data.total) {
                // Use the season month/year from the key, not the specific end date
                const monthName = new Date(Date.UTC(r.key.seasonYear, r.key.seasonMonth - 1, 1))
                    .toLocaleString('default', { month: 'long' });

                fullHistory.push({
                    label: monthName,
                    total: r.data.total,
                    month: r.key.seasonMonth,
                    year: r.key.seasonYear
                });
            }
        });

        // 4. Deduplicate (in case of overlap with legacy data)
        const seen = new Set();
        const uniqueHistory = [];

        fullHistory.forEach(item => {
            const id = `${item.year}-${item.month}`;
            if (!seen.has(id)) {
                seen.add(id);
                uniqueHistory.push(item);
            }
        });

        // 5. Sort chronologically
        uniqueHistory.sort((a, b) => {
            if (a.year !== b.year) return a.year - b.year;
            return a.month - b.month;
        });

        return c.json(uniqueHistory);

    } catch (error) {
        logError('[Season History]', error);
        return errorResponse(c, 'Failed to fetch season history');
    }
}


