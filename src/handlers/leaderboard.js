import { getSeasonStart, getCurrentSeason, getSeasonStartForMonth, getSeasonEnd } from '../utils/seasons.js';
import { getLeaderboardKey, getPlayerHistoryKey } from '../utils/keys.js';
import { refreshPlayerKeyCache } from '../utils/searchCache.js';

// --- SHARED CONSTANTS ---
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minutes
const ALLIANCE_API_URL = "https://quiet-mountain-519c.scottieofaberoth.workers.dev";

// --- STATE/CACHE ---
let liveRankCache = { timestamp: 0, data: new Map() };
let allianceCache = { timestamp: 0, data: new Map() };

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
 * Fetches and maps alliances (Player Name -> {tag, name, uuid, playerName})
 */
async function fetchAllianceMap() {
    const now = Date.now();
    if (now - allianceCache.timestamp < CACHE_TTL_MS && allianceCache.data.size > 0) {
        return allianceCache.data;
    }

    try {
        const res = await fetch(ALLIANCE_API_URL);
        if (!res.ok) return allianceCache.data;
        const data = await res.json();

        const map = new Map();
        Object.entries(data).forEach(([playerName, info]) => {
            const normName = playerName.trim().toLowerCase();
            map.set(normName, {
                tag: info.tag,
                name: info.alliance_name,
                uuid: info.id,
                playerName: playerName
            });
        });
        allianceCache = { timestamp: now, data: map };
        return map;
    } catch (e) {
        return allianceCache.data;
    }
}

/**
 * Fetches live Top 1000 ranks from the official API.
 */
async function getLiveRankMap() {
    const now = Date.now();
    if (now - liveRankCache.timestamp < CACHE_TTL_MS && liveRankCache.data.size > 0) {
        return liveRankCache.data;
    }

    const { year, month } = getCurrentSeason(new Date());
    const apiUrl = `https://marvelsnap.com/wp-json/api/v1/leaderboard?month=${month}&year=${year}&region=global`;

    try {
        const res = await fetch(apiUrl);
        if (!res.ok) return liveRankCache.data;
        const data = await res.json();

        const newMap = new Map();
        if (data?.results) {
            data.results.forEach((entry, index) => {
                const rank = index + 1;
                // Force String ID for consistency with KV
                const id = String(entry.id || entry.playerId);

                // Store BOTH rank and name (API uses 'playerName' or 'name')
                if (id) {
                    newMap.set(id, { rank, name: entry.playerName || entry.name });
                }
            });
        }

        liveRankCache = { timestamp: now, data: newMap };
        return newMap;
    } catch (e) {
        return liveRankCache.data;
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





export async function handlePlayerHistory(c) {
    const name = c.req.query('name') || c.req.query('q');

    if (!name) {
        return c.json({ error: "Missing name/q parameter" }, 400);
    }

    const lowerQuery = name.trim().toLowerCase();

    // 1. Get Full Key List (Cached)
    const allKeys = await refreshPlayerKeyCache(c.env.MARVEL_SNAP_HUB);

    // 2. Perform In-Memory Fuzzy Search
    // Filter keys that INCLUDE the query (case-insensitive)
    // Key format: "map:somelowercasename"
    const matchedKeys = allKeys.filter(k => {
        const rawName = k.replace("map:", "");
        return rawName.toLowerCase().includes(lowerQuery);
    });

    // 3. Sort Matches by Relevance
    // Relevance: Exact Match > Starts With > Includes
    matchedKeys.sort((a, b) => {
        const nameA = a.replace("map:", "").toLowerCase();
        const nameB = b.replace("map:", "").toLowerCase();

        const exactA = nameA === lowerQuery;
        const exactB = nameB === lowerQuery;
        if (exactA && !exactB) return -1;
        if (!exactA && exactB) return 1;

        const startA = nameA.startsWith(lowerQuery);
        const startB = nameB.startsWith(lowerQuery);
        if (startA && !startB) return -1;
        if (!startA && startB) return 1;

        return nameA.localeCompare(nameB);
    });

    // Limit to top 15 matches (paginated)
    const cursor = parseInt(c.req.query('cursor') || '0', 10);
    const PAGE_SIZE = 15;
    const topMatches = matchedKeys.slice(cursor, cursor + PAGE_SIZE);

    let allPlayerIds = [];

    // 4. Fetch IDs for matches
    if (topMatches.length > 0) {
        const matchPromises = topMatches.map(kName => c.env.MARVEL_SNAP_HUB.get(kName, { type: 'json' }));
        const results = await Promise.all(matchPromises);

        results.forEach(res => {
            if (Array.isArray(res)) allPlayerIds.push(...res);
            else if (res) allPlayerIds.push(res);
        });
    }

    allPlayerIds = [...new Set(allPlayerIds)];

    // 5. Fetch Latest Leaderboard (Live)
    const rankMap = await getLiveRankMap();

    // 6. Fetch History list & Enrich
    const profiles = await Promise.all(allPlayerIds.map(async (id) => {
        const history = await c.env.MARVEL_SNAP_HUB.get(getPlayerHistoryKey(id), { type: 'json' });

        const liveEntry = rankMap.get(id);

        // Use live name if available, otherwise history name
        const displayName = liveEntry?.name || getCurrentNameFromHistory(history);
        const displayRank = liveEntry?.rank || null;

        // Inject live name if it's different from last history entry 
        if (liveEntry && liveEntry.name) {
            const lastRec = history[history.length - 1];
            const todayStr = new Date().toISOString().split('T')[0];
            if (!lastRec || (lastRec.name !== liveEntry.name && lastRec.seenAt !== todayStr)) {
                history.push({ name: liveEntry.name, seenAt: todayStr });
            }
        }

        return {
            playerId: id,
            name: displayName,
            currentRank: displayRank,
            history: history || []
        };
    }));

    // Sort by Rank (if available) then Name

    profiles.sort((a, b) => {
        if (a.currentRank && b.currentRank) return a.currentRank - b.currentRank;
        if (a.currentRank) return -1;
        if (b.currentRank) return 1;
        return 0;
    });

    // Check for Text Format (Twitch)
    const format = c.req.query('format');
    if (format === 'text') {
        if (profiles.length === 0) return c.text(`No matches found for "${name}".`);

        const topMatches = profiles.slice(0, 5); // Limit to top 5 for chat
        const lines = []; // Removed header line

        topMatches.forEach(p => {
            let line = "";
            if (p.currentRank) line += `#${p.currentRank} `;
            else line += `(UR) `;

            line += p.name;

            // Find unique aliases from history
            if (p.history && p.history.length > 0) {
                const aliases = [...new Set(p.history.map(h => h.name))]
                    .filter(n => n !== p.name && n !== p.name.trim()); // Exclude current name

                if (aliases.length > 0) {
                    line += ` (aka ${aliases.slice(0, 2).join(", ")})`; // Limit aliases
                }
            }
            lines.push(line);
        });

        if (profiles.length > 5) lines.push(`...and ${profiles.length - 5} more.`);

        // Twitch chat doesn't support newlines, so we use ", " for clean separation
        return c.text(lines.join(', '));
    }

    const nextCursor = (cursor + PAGE_SIZE < matchedKeys.length) ? cursor + PAGE_SIZE : null;

    return c.json({
        query: name,
        matches: profiles,
        total: matchedKeys.length,
        nextCursor: nextCursor
    });
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

    // 1. Fetch History (Names) AND Alliance Map
    const historyPromise = c.env.MARVEL_SNAP_HUB.get(getPlayerHistoryKey(id), { type: 'json' });
    const alliancePromise = fetchAllianceMap();

    // 2. Fetch Season Stats (Daily)
    const seasonKeys = getSeasonDailyKeys(targetDate);
    const seasonPromises = seasonKeys.map(k => c.env.MARVEL_SNAP_HUB.get(k.key, { type: 'json' }).then(data => ({ date: k.date, data })));

    // 3. Fetch Historical Season Ends
    const historicalKeys = getHistoricalSeasonEndKeys();
    const historyRankPromises = historicalKeys.map(k => c.env.MARVEL_SNAP_HUB.get(k.key, { type: 'json' }).then(data => ({ date: k.date, label: k.seasonName, data })));

    const [history, allianceMap, ...allResults] = await Promise.all([historyPromise, alliancePromise, ...seasonPromises, ...historyRankPromises]);

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

    const allianceInfo = allianceMap.get(currentName.trim().toLowerCase()) || null;

    // Determine Current Rank (LIVE)
    const liveRankMap = await getLiveRankMap();
    const liveEntry = liveRankMap.get(id); // { rank, name }

    let currentRank = liveEntry ? liveEntry.rank : null;
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
        alliance: allianceInfo, // { tag, name }
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



export async function handleAllianceProfile(c) {
    const tag = c.req.param('tag').toUpperCase(); // Tags are usually uppercase
    if (!tag) return c.json({ error: "Missing Tag" }, 400);

    // 1. Get Latest Leaderboard (Fallback Logic)
    let now = new Date();
    let key = getLeaderboardKey(now);
    let leaderboard = [];
    let snapshotDate = now.toISOString().split('T')[0];

    try {
        let data = await c.env.MARVEL_SNAP_HUB.get(key, { type: 'json' });

        // If today is empty, try yesterday
        if (!data || !data.results) {
            now.setDate(now.getDate() - 1);
            key = getLeaderboardKey(now);
            snapshotDate = now.toISOString().split('T')[0];
            data = await c.env.MARVEL_SNAP_HUB.get(key, { type: 'json' });
        }

        if (data && data.results) leaderboard = data.results;
        else return c.json({ error: "No leaderboard data available (checked Today & Yesterday)." }, 404);

    } catch (e) {
        return c.json({ error: "Failed to load leaderboard." }, 500);
    }

    // 2. Get Alliance Map
    const allianceMap = await fetchAllianceMap();

    // 3. Filter Members
    const members = [];
    const aliases = new Set();

    leaderboard.forEach(p => {
        const lowerName = (p.playerName || '').trim().toLowerCase();
        const info = allianceMap.get(lowerName);

        if (info && info.tag === tag) {
            if (info.name) aliases.add(info.name);
            members.push({
                id: p.playerId,
                name: p.playerName,
                rank: p.rank + 1, // Fix 0-indexing
                score: p.score
            });
        }
    });

    if (members.length === 0) {
        return c.json({ error: `No members found for [${tag}] in the Top 1000.` }, 404);
    }

    // 4. Calculate Stats
    // We also need to compute the "Power Rank" relative to other alliances.
    // This is expensive to do on every request, but sticking to the plan:
    // We'll quickly aggregate ALL alliances to find the rank of ours.

    const allStats = {};
    leaderboard.forEach(p => {
        const lowerName = (p.playerName || '').trim().toLowerCase();
        const info = allianceMap.get(lowerName);
        if (info && info.tag && info.tag !== 'UNTAGGED') {
            if (!allStats[info.tag]) allStats[info.tag] = { count: 0 };
            allStats[info.tag].count++;
        }
    });

    // Sort alliances by member count (Power Rank definition)
    const sortedTags = Object.entries(allStats)
        .sort((a, b) => b[1].count - a[1].count)
        .map(x => x[0]);

    const powerRank = sortedTags.indexOf(tag) + 1;

    // Aggregate our stats
    const sortedAliases = [...aliases].sort((a, b) => a.localeCompare(b));
    // Use the first sorted alias as display name fallback (though template will use all)
    const displayName = sortedAliases[0] || tag;

    // Sort roster by rank
    const sortedRoster = members.sort((a, b) => a.rank - b.rank);

    const allianceData = {
        tag: tag,
        name: displayName,
        knownNames: sortedAliases, // Alphabetically sorted
        members: members.length,
        totalSP: members.reduce((sum, m) => sum + m.score, 0),
        avgSP: members.length > 0 ? (members.reduce((sum, m) => sum + m.score, 0) / members.length) : 0,
        highestRank: members.length > 0 ? sortedRoster[0].rank : 0,
        powerRank: powerRank,
        snapshotDate: snapshotDate,
        roster: sortedRoster
    };

    return c.json(allianceData);
}

export async function handleLeaderboardComparison(c) {
    const date1Str = c.req.query('date1'); // e.g. Today
    const date2Str = c.req.query('date2'); // e.g. Yesterday

    if (!date1Str || !date2Str) {
        return c.json({ error: "Missing date1 or date2" }, 400);
    }

    // Parallel fetch: Leaderboards + Alliances
    const [d1, d2, allianceMap] = await Promise.all([
        c.env.MARVEL_SNAP_HUB.get(getLeaderboardKey(date1Str), { type: 'json' }),
        c.env.MARVEL_SNAP_HUB.get(getLeaderboardKey(date2Str), { type: 'json' }),
        fetchAllianceMap()
    ]);

    if (!d1 || !d2) {
        return c.json({ error: "Data missing for one or both dates." }, 404);
    }

    // Process Momentum & Build Alliance Stats
    // 1. Build map of Day 2 (Yesterday)
    const prevMap = new Map();
    d2.results.forEach(p => prevMap.set(p.playerId, p.score));

    const movers = [];
    const allianceStats = {};

    d1.results.forEach(curr => {
        // --- Alliance Logic ---
        const lowerName = (curr.playerName || '').trim().toLowerCase();
        const alliance = allianceMap.get(lowerName);

        if (alliance?.tag && alliance.tag !== 'UNTAGGED') {
            const key = alliance.tag;
            if (!allianceStats[key]) {
                allianceStats[key] = {
                    tag: alliance.tag,
                    name: alliance.name,
                    members: 0,
                    totalSP: 0,
                    highestRank: 99999,
                    netChange: 0
                };
            }
            allianceStats[key].members++;
            allianceStats[key].totalSP += curr.score;
            // Ranks are 1-based in normalized display
            allianceStats[key].highestRank = Math.min(allianceStats[key].highestRank, curr.rank + 1);
        }

        // --- Movers Logic ---
        const prevScore = prevMap.get(curr.playerId);
        if (prevScore !== undefined) {
            const diff = curr.score - prevScore;

            if (alliance?.tag && alliance.tag !== 'UNTAGGED') {
                const key = alliance.tag;
                if (allianceStats[key]) {
                    allianceStats[key].netChange += diff;
                }
            }

            movers.push({
                name: curr.playerName,
                id: curr.playerId,
                change: diff,
                rank: curr.rank || 0,
                alliance: alliance
            });
        }
    });

    const rankings = Object.values(allianceStats).map(a => ({
        ...a,
        avgSP: Math.round(a.totalSP / a.members)
    }));

    movers.sort((a, b) => b.change - a.change);

    return c.json({
        topGainers: movers.slice(0, 50),
        topLosers: movers.slice(-50).reverse(),
        allianceRankings: rankings.sort((a, b) => b.members - a.members).slice(0, 50),
        date1: date1Str,
        date2: date2Str
    });
}
