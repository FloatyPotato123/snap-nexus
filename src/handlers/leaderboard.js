import { getSeasonStart, getCurrentSeason, getSeasonStartForMonth, getSeasonEnd } from '../utils/seasons.js';
import { getLeaderboardKey } from '../utils/keys.js';
import { searchPlayers, getPlayerHistory, batchGetPlayerHistories } from '../utils/db.js';

// --- SHARED CONSTANTS ---
const CACHE_TTL_MS = 60 * 1000; // 1 Minute
// --- STATE/CACHE ---
let liveLeaderboardCache = { timestamp: 0, data: new Map(), total: 0 };

// --- HELPERS ---

/**
 * Extracts the most recent name from a player's history array.
 */
function getCurrentNameFromHistory(history) {
    if (!history || history.length === 0) return "Unknown";
    // Sort by seenAt descending
    const sorted = [...history].sort((a, b) => new Date(b.seenAt) - new Date(a.seenAt));
    return sorted[0].name || "Unknown";
}


/**
 * Fetches live Top 1000 ranks and global Infinite total from the official API.
 * @returns {Promise<{map: Map, total: number}>}
 */
async function getLiveLeaderboardData() {
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

/**
 * API: Search Player History
 * 
 * Twitch Command: !whois [name]
 * Output Example: #4 Awesome Andy (aka Dr.ShrimpPuertoRico, Smlz, Negative One-Trick), #10 Cougarrr (aka Cougarrr727, Negative One-Trick), #65 Denish (aka Denish727, Door Hinge (C3 Main), Negative One-Trick), #629 Tequila Pete (aka Guy Spelunky, Negative One-Trick)
 */
export async function handlePlayerHistory(c) {
    const url = new URL(c.req.url);
    const name = url.searchParams.get("name") || url.searchParams.get("q");
    const format = url.searchParams.get("format"); // 'json' or 'text'
    const qLimit = parseInt(url.searchParams.get("limit") || "100");

    if (!name || name.length < 2) {
        if (format === 'text') return c.text("Please provide a search term (min 2 chars).");
        return c.json({ matches: [] });
    }

    try {
        // 1. Search Index (D1) -> Get IDs
        const candidates = await searchPlayers(c.env.DB, name, qLimit);

        if (candidates.length === 0) {
            if (format === 'text') return c.text("No players found.");
            return c.json({ matches: [] });
        }

        // Deduplicate IDs
        const uniqueIds = [...new Set(candidates.map(p => p.id))];

        // 2. Hydrate with History (D1) - One single query for all IDs
        const historyMap = await batchGetPlayerHistories(c.env.DB, uniqueIds);
        const { map: liveMap } = await getLiveLeaderboardData();

        const enriched = uniqueIds.map(id => {
            const history = historyMap[id] || [];

            let displayName = "";
            let currentRank = null;

            const liveEntry = liveMap.get(id);
            if (liveEntry) {
                currentRank = liveEntry.rank;
                displayName = liveEntry.name;
            }

            if (history.length > 0) {
                const latest = history[history.length - 1];
                if (!displayName) displayName = latest.name;
            }

            // Fallback
            if (!displayName) {
                const match = candidates.find(c => c.id === id);
                if (match) displayName = match.name;
            }

            return {
                id: id,
                playerId: id,
                name: displayName || "Unknown",
                currentRank,
                history: history
            };
        });

        // 3. Sort by Rank (Ascending)
        enriched.sort((a, b) => {
            const r1 = a.currentRank || 999999;
            const r2 = b.currentRank || 999999;
            return r1 - r2;
        });

        // --- TEXT FORMATTING ---
        if (format === 'text') {
            return c.text(formatSearchTextOutput(enriched));
        }

        return c.json({ matches: enriched });
    } catch (e) {
        console.error("Search Error:", e);
        if (format === 'text') return c.text(`Search Error: ${e.message}`);
        return c.json({ matches: [], error: e.message });
    }
}

/**
 * Formats a list of players into a concise comma-separated string.
 * Truncates output to fit within ~400 characters.
 */
function formatSearchTextOutput(players) {
    const MAX_LENGTH = 380;
    let output = "";

    for (let i = 0; i < players.length; i++) {
        const p = players[i];

        // Filter aliases (exclude current display name)
        // p.history is an array of { name, seenAt }
        const uniqueAliases = [...new Set(p.history.map(h => h.name))]
            .filter(n => n && n !== p.name);

        const akaStr = uniqueAliases.length > 0 ? ` (aka ${uniqueAliases.join(', ')})` : "";

        // Format: #Rank Name OR Name
        const rankPart = p.currentRank ? `#${p.currentRank} ` : '';
        const entry = `${rankPart}${p.name}${akaStr}`;

        const separator = (i === 0) ? "" : ", ";
        const tentativeLen = output.length + separator.length + entry.length;

        if (tentativeLen > MAX_LENGTH) {
            output += `, ... (+${players.length - i} more)`;
            break;
        }

        output += separator + entry;
    }
    return output;
}

// Helper: Get daily keys for a specific season
// targetDate: A date within the desired API month/year
function getSeasonDailyKeys(targetDate) {
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
function getHistoricalSeasonEndKeys() {
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

export async function handleGetPlayerProfile(c) {
    const id = c.req.param('id');
    const qMonth = c.req.query('month');
    const qYear = c.req.query('year');

    if (!id) return c.json({ error: "Missing ID" }, 400);

    // Determines which season's daily stats to fetch
    let targetDate;
    if (qMonth && qYear) {
        targetDate = new Date(Date.UTC(parseInt(qYear), parseInt(qMonth) - 1, 15));
    } else {
        // Default to Current Active Season
        const { year, month } = getCurrentSeason(new Date());
        targetDate = new Date(Date.UTC(year, month - 1, 15));
    }

    // 1. Fetch History (Names) from D1
    const historyPromise = getPlayerHistory(c.env.DB, id);

    // 2. Fetch Season Stats (Daily)
    const seasonKeys = getSeasonDailyKeys(targetDate);
    const seasonPromises = seasonKeys.map(k => c.env.MARVEL_SNAP_HUB.get(k.key, { type: 'json' }).then(data => ({ date: k.date, data })));

    // 3. Fetch Historical Season Ends
    const historicalKeys = getHistoricalSeasonEndKeys();
    const historyRankPromises = historicalKeys.map(k => c.env.MARVEL_SNAP_HUB.get(k.key, { type: 'json' }).then(data => ({ date: k.date, label: k.seasonName, data })));

    const [history, ...allResults] = await Promise.all([historyPromise, ...seasonPromises, ...historyRankPromises]);

    // Split results back out
    const seasonResults = allResults.slice(0, seasonKeys.length);
    const historyRankResults = allResults.slice(seasonKeys.length);

    // Process Current Season Stats
    const stats = seasonResults
        .filter(r => r.data && r.data.results)
        .map(r => {
            const entry = r.data.results.find(p => p.playerId === id || p.id === id);
            if (!entry) return null;
            return {
                date: r.date,
                rank: entry.rank + 1,
                sp: entry.score
            };
        })
        .filter(s => s !== null);

    // Process Historical Ranks
    const historicalRanks = historyRankResults
        .map(r => {
            if (!r.data || !r.data.results) return null;
            const entry = r.data.results.find(p => p.playerId === id || p.id === id);
            if (!entry) return null;
            return {
                season: r.label,
                rank: entry.rank + 1,
                sp: entry.score
            };
        })
        .filter(s => s !== null);

    const currentName = getCurrentNameFromHistory(history);

    // Determine Current Rank (LIVE)
    const { map: liveRankMap } = await getLiveLeaderboardData();
    const liveEntry = liveRankMap.get(id); // { rank, name }

    let currentRank = liveEntry ? liveEntry.rank : null;
    let currentSP = liveEntry ? liveEntry.score : null;
    let finalName = liveEntry ? liveEntry.name : currentName;

    // Inject live name if it's different from last history entry 
    if (liveEntry && liveEntry.name) {
        const lastRec = history[history.length - 1];
        const todayStr = new Date().toISOString().split('T')[0];

        if (!lastRec || (lastRec.name !== liveEntry.name && lastRec.seenAt !== todayStr)) {
            history.push({ name: liveEntry.name, seenAt: todayStr });
        }
    }

    // If user fell out of top 1000 *right now*, they are unranked.

    return c.json({
        id,
        name: finalName,
        currentRank: currentRank,
        currentSP: currentSP,
        history: history,
        currentSeasonStats: stats, // Daily stats for current season
        historicalSeasonRanks: historicalRanks // Rank at end of past seasons
    });
}

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

    // Limit range to prevent massive fetching
    if (dates.length > 60) {
        return c.json({ error: "Date range too large (max 60 days)" }, 400);
    }

    const results = await Promise.all(dates.map(async date => {
        const y = date.getUTCFullYear();
        const m = String(date.getUTCMonth() + 1).padStart(2, '0');
        const d = String(date.getUTCDate()).padStart(2, '0');
        const key = getLeaderboardKey(date);

        try {
            const data = await c.env.MARVEL_SNAP_HUB.get(key, { type: 'json' });
            return {
                date: `${y}-${m}-${d}`,
                total: data ? data.total : null
            };
        } catch (e) {
            return { date: `${y}-${m}-${d}`, total: null };
        }
    }));

    // Filter out nulls/future dates if needed, or return all
    return c.json(results.filter(r => r.total !== null));
}



import { HISTORICAL_DATA } from '../utils/legacy_data.js';

export function handleLegacyHistory(c) {
    return c.json(HISTORICAL_DATA);
}




export async function handleLeaderboardComparison(c) {
    const date1Str = c.req.query('date1'); // e.g. Today
    const date2Str = c.req.query('date2'); // e.g. Yesterday

    if (!date1Str || !date2Str) {
        return c.json({ error: "Missing date1 or date2" }, 400);
    }

    // Parallel fetch: Leaderboards + Live Data
    const [d1, d2, { map: liveRankMap, total: liveTotal }] = await Promise.all([
        c.env.MARVEL_SNAP_HUB.get(getLeaderboardKey(date1Str), { type: 'json' }),
        c.env.MARVEL_SNAP_HUB.get(getLeaderboardKey(date2Str), { type: 'json' }),
        getLiveLeaderboardData()
    ]);

    if (!d1 || !d2) {
        return c.json({ error: "Data missing for one or both dates." }, 404);
    }

    // Process Momentum
    // 1. Build map of Day 2 (Yesterday)
    const prevMap = new Map();
    d2.results.forEach(p => prevMap.set(p.playerId, p.score));

    const movers = [];

    // We strictly use d1 (Snapshot) for Movers to ensure consistency with the "24h Change" logic
    d1.results.forEach(curr => {
        const prevScore = prevMap.get(curr.playerId);
        if (prevScore !== undefined) {
            const diff = curr.score - prevScore;
            movers.push({
                name: curr.playerName,
                id: curr.playerId,
                change: diff,
                spStart: prevScore,
                spEnd: curr.score,
                rank: curr.rank || 0
            });
        }
    });

    movers.sort((a, b) => b.change - a.change);

    // Explicitly filter to avoid crossover
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
        const { map, total } = await getLiveLeaderboardData();
        const results = Array.from(map.values()).sort((a, b) => a.rank - b.rank);

        return c.json({
            results,
            total
        });
    } catch (e) {
        return c.json({ error: "Failed to fetch live leaderboard." }, 500);
    }
}
