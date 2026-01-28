import { getSeasonStart, getSeasonEnd } from '../utils/seasons.js';
import { getLeaderboardKey } from '../utils/keys.js';
import { HISTORICAL_DATA } from '../utils/legacy_data.js';
import { getDailyTotalsRange } from '../utils/db.js';

// --- HELPERS ---

// Helper: Get daily keys for a specific season
// targetDate: A date within the desired API month/year
export function getSeasonDailyKeys(targetDate) {
    const seasonStart = getSeasonStart(targetDate);

    // Calculate Season End using helper
    const seasonEnd = getSeasonEnd(seasonStart);

    // Limit to Today if displaying current/future season
    const now = new Date();
    const end = (now < seasonEnd && now >= seasonStart) ? now : seasonEnd;

    const keys = [];
    const cur = new Date(seasonStart);
    cur.setUTCDate(cur.getUTCDate() + 1); // Skip Day 1 (Reset Day) as it contains Old Season Final Data
    while (cur <= end) {
        const y = cur.getUTCFullYear();
        const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
        const d = String(cur.getUTCDate()).padStart(2, '0');

        // Note: we need the date string separately too for the chart
        const dateStr = `${y}-${m}-${d}`;
        keys.push({
            key: getLeaderboardKey(cur),
            date: dateStr
        });
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return keys;
}

// Helper: Get keys for End of Past Seasons (Last ~6 months)
export function getHistoricalSeasonEndKeys() {
    const keys = [];
    const now = new Date();
    // Go back 6 months
    for (let i = 1; i <= 6; i++) {
        const d = new Date(now);
        d.setUTCMonth(d.getUTCMonth() - i);
        const seasonEnd = getSeasonEnd(d);

        keys.push({
            key: getLeaderboardKey(seasonEnd),
            date: seasonEnd.toISOString().split('T')[0],
            seasonName: d.toLocaleString('default', { month: 'short', year: '2-digit' }) // E.g. "Dec 25" (based on the season month, not end date)
        });
    }
    return keys.reverse(); // Chronological
}

// --- HANDLERS ---

export async function handleHistoryRange(c) {
    const start = c.req.query('start');
    const end = c.req.query('end');

    if (!start || !end) {
        return c.json({ error: "Missing start or end date (YYYY-MM-DD)" }, 400);
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    const dates = [];

    // Generate date range
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dates.push(new Date(d));
    }

    // Limit range to prevent massive fetching (though D1 is much more efficient)
    if (dates.length > 90) {
        return c.json({ error: "Date range too large (max 90 days)" }, 400);
    }

    // D1 Path
    const results = await getDailyTotalsRange(c.env.DB, start, end);
    return c.json(results);
}

export function handleLegacyHistory(c) {
    return c.json(HISTORICAL_DATA);
}
