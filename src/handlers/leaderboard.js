import { getLeaderboardKey } from '../utils/keys.js';
import { getCurrentSeason } from '../utils/seasons.js';

// --- SHARED CONSTANTS ---
const CACHE_TTL_MS = 60 * 1000; // 1 Minute
// --- STATE/CACHE ---
let liveLeaderboardCache = { timestamp: 0, data: new Map(), total: 0 };

// --- HELPERS ---

/**
 * Fetches live Top 1000 ranks and global Infinite total from the official API.
 * @returns {Promise<{map: Map, total: number}>}
 */
export async function getLiveLeaderboardData() {
    const now = Date.now();
    if (now - liveLeaderboardCache.timestamp < CACHE_TTL_MS && liveLeaderboardCache.data.size > 0) {
        return { map: liveLeaderboardCache.data, total: liveLeaderboardCache.total };
    }

    const { year, month } = getCurrentSeason(new Date());
    const apiUrl = `https://marvelsnap.com/wp-json/api/v1/leaderboard?month=${month}&year=${year}&region=global`;

    try {
        const res = await fetch(apiUrl);
        if (!res.ok) return { map: liveLeaderboardCache.data, total: liveLeaderboardCache.total };
        const data = await res.json();

        const newMap = new Map();
        if (data?.results) {
            data.results.forEach((entry, index) => {
                const rank = index + 1;
                // Force String ID for consistency with KV
                const id = String(entry.id || entry.playerId);

                if (id) {
                    newMap.set(id, {
                        id, // Include ID in the object
                        rank,
                        name: entry.playerName,
                        score: entry.score
                    });
                }
            });
        }

        const globalTotal = data?.total || 0;
        liveLeaderboardCache = { timestamp: now, data: newMap, total: globalTotal };
        return { map: newMap, total: globalTotal };
    } catch (e) {
        return { map: liveLeaderboardCache.data, total: liveLeaderboardCache.total };
    }
}


export async function handleLeaderboard(c) {
    const year = c.req.query('year');
    const month = c.req.query('month');
    const day = c.req.query('day');

    if (!year || !month || !day) {
        return c.json({ error: "Missing parameters. Use ?year=YYYY&month=MM&day=DD" }, 400);
    }

    // Pad inputs to ensure YYYY-MM-DD format
    const m = month.padStart(2, '0');
    const d = day.padStart(2, '0');
    const key = getLeaderboardKey(`${year}-${m}-${d}`);

    try {
        const data = await c.env.MARVEL_SNAP_HUB.get(key, { type: 'json' });

        if (!data) {
            return c.json({ error: "No data found for this date." }, 404);
        }

        return c.json(data);
    } catch (e) {
        return c.json({ error: "Failed to fetch data." }, 500);
    }
}

export async function handleLeaderboardComparison(c) {
    const date1Str = c.req.query('date1'); // e.g. Today
    const date2Str = c.req.query('date2'); // e.g. Yesterday

    if (!date1Str || !date2Str) {
        return c.json({ error: "Missing date1 or date2" }, 400);
    }

    // Parallel fetch: Leaderboards + Live Data
    const [d1, d2, { total: liveTotal }] = await Promise.all([
        c.env.MARVEL_SNAP_HUB.get(getLeaderboardKey(date1Str), { type: 'json' }),
        c.env.MARVEL_SNAP_HUB.get(getLeaderboardKey(date2Str), { type: 'json' }),
        getLiveLeaderboardData()
    ]);

    if (!d1 || !d2) {
        return c.json({ error: "Data missing for one or both dates." }, 404);
    }

    // Process Momentum
    const prevMap = new Map();
    if (d2.results) d2.results.forEach(p => prevMap.set(p.playerId || p.id, p.score));

    const movers = [];
    if (d1.results) {
        d1.results.forEach(curr => {
            const pid = curr.playerId || curr.id;
            const prevScore = prevMap.get(pid);
            if (prevScore !== undefined) {
                const diff = curr.score - prevScore;
                movers.push({
                    name: curr.playerName || curr.name,
                    id: pid,
                    change: diff,
                    spStart: prevScore,
                    spEnd: curr.score,
                    rank: curr.rank || 0
                });
            }
        });
    }

    movers.sort((a, b) => b.change - a.change);
    const gainers = movers.filter(m => m.change > 0);
    const losers = movers.filter(m => m.change < 0);

    return c.json({
        topGainers: gainers.slice(0, 50),
        topLosers: losers.reverse().slice(0, 50),
        date1: date1Str,
        date2: date2Str,
        totalInfinitePlayers: liveTotal
    });
}

export async function handleGetLiveLeaderboard(c) {
    try {
        // 1. Fetch Live Data
        const { map, total } = await getLiveLeaderboardData();

        // 2. Fetch Yesterday's Snapshot for comparison from KV (Most efficient for full 1k list)
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const yKey = getLeaderboardKey(yesterday);
        const prevData = await c.env.MARVEL_SNAP_HUB.get(yKey, { type: 'json' });

        // 3. Build Previous Rank Map
        const prevRankMap = new Map();
        if (prevData && prevData.results) {
            // Guarantee sort order before using index as rank
            const sortedPrev = [...prevData.results].sort((a, b) => b.score - a.score);

            sortedPrev.forEach((p, i) => {
                const r = i + 1;
                prevRankMap.set(String(p.playerId || p.id), r);
            });
        }

        // 4. Calculate Deltas
        const results = Array.from(map.values())
            .map(p => {
                const prevRank = prevRankMap.get(String(p.id));
                const delta = prevRank ? (prevRank - p.rank) : null;
                const isNew = prevRank === undefined;

                return { ...p, delta, isNew };
            })
            .sort((a, b) => a.rank - b.rank);

        return c.json({
            results,
            total
        });
    } catch (e) {
        console.error("Leaderboard Error:", e);
        return c.json({ error: "Failed to fetch live leaderboard." }, 500);
    }
}

export async function handleDebugSnapshot(c) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yKey = getLeaderboardKey(yesterday);
    const prevData = await c.env.MARVEL_SNAP_HUB.get(yKey, { type: 'json' });

    if (!prevData) return c.json({ error: "No data for yesterday", key: yKey });

    // Show top 5 raw entries
    const sample = prevData.results ? prevData.results.slice(0, 5) : [];

    return c.json({
        key: yKey,
        total: prevData.results ? prevData.results.length : 0,
        sample: sample
    });
}
