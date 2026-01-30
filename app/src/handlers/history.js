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
            seasonName: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
            seasonMonth: d.getUTCMonth() + 1,
            seasonYear: d.getUTCFullYear()
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

export async function handleSeasonHistory(c) {
    // 1. Start with Hardcoded Legacy Data (May - Nov 2025)
    let fullHistory = [...HISTORICAL_DATA];

    // 2. Fetch Completed Seasons from D1
    const historicalKeys = getHistoricalSeasonEndKeys();

    // We want the Total Player Count for the *End Date* of each season.
    const promises = historicalKeys.map(k =>
        getDailyTotalsRange(c.env.DB, k.date, k.date)
            .then(res => ({ key: k, data: res[0] }))
    );

    const d1Results = await Promise.all(promises);

    // 3. Merge D1 Results into History
    d1Results.forEach(r => {
        if (r.data && r.data.total) {
            // Use the Season Month/Year from the key, not the specific End Date
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

    // 4. Deduplicate (Case: logic overlap with legacy)
    const seen = new Set();
    const uniqueHistory = [];
    fullHistory.forEach(item => {
        const id = `${item.year}-${item.month}`;
        if (!seen.has(id)) {
            seen.add(id);
            uniqueHistory.push(item);
        }
    });

    // 5. Sort Chronologically
    uniqueHistory.sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
    });

    return c.json(uniqueHistory);
}

