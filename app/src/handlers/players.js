import { searchPlayers, getPlayerHistory, getPlayerStatsRange, batchGetPlayerHistories, getPlayerHistoricalRanks } from '../utils/db.js';
import { getCurrentSeason, getSeasonStart, getSeasonEnd } from '../utils/seasons.js';
import { getSeasonDailyKeys, getHistoricalSeasonEndKeys } from './history.js';
import { getLiveLeaderboardData } from './leaderboard.js';

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
 * Formats a list of players into a concise comma-separated string.
 * Truncates output to fit within ~400 characters.
 */
function formatSearchTextOutput(players) {
    if (!players || players.length === 0) return "No players found.";

    let outputParts = [];
    let currentLength = 0;
    const MAX_LENGTH = 400;

    for (const p of players) {
        // Basic Info: "#Rank Name" (Rank is not stored in search index, so just Name)
        // If we want rank, we'd need to fetch live leaderboard comparison, but this is simple search.

        let nameStr = p.name;

        // Add Aliases if available
        if (p.history && p.history.length > 1) {
            // Filter out the current name from history to find aliases
            const uniqueAliases = [...new Set(p.history.map(h => h.name).filter(n => n !== p.name))];
            if (uniqueAliases.length > 0) {
                nameStr += ` (aka ${uniqueAliases.join(', ')})`;
            }
        }

        const entry = nameStr;
        if (currentLength + entry.length + 2 > MAX_LENGTH) {
            outputParts.push("...");
            break;
        }

        outputParts.push(entry);
        currentLength += entry.length + 2; // +2 for ", "
    }

    return outputParts.join(', ');
}

// --- HANDLERS ---

/**
 * API: Search Player History
 * 
 * Twitch Command: !whois [name]
 * Output Example: Awesome Andy (aka Dr.ShrimpPuertoRico), Cougarrr, Denish
 */
export async function handlePlayerHistory(c) {
    const q = c.req.query("q");
    const format = c.req.query("format"); // 'text' for Twitch, 'json' (default) for web
    const limit = parseInt(c.req.query("limit") || "20"); // Default 20, but respect param

    if (!q || q.length < 2) {
        if (format === 'text') return c.text("Please provide a name (min 2 chars).");
        return c.json({ error: "Query too short" }, 400);
    }

    const db = c.env.DB;
    // 1. Search in Index
    const rawResults = await searchPlayers(db, q, limit);

    // Deduplicate by ID
    const seenIds = new Set();
    const uniqueResults = [];
    for (const r of rawResults) {
        if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            uniqueResults.push(r);
        }
    }

    // 2. Fetch Live Data for cross-reference
    const { map: liveMap } = await getLiveLeaderboardData();

    // 3. Hydrate with History & Live Data
    const playerIds = uniqueResults.map(p => p.id);
    const historyMap = await batchGetPlayerHistories(db, playerIds);

    const enrichedResults = [];
    for (const p of uniqueResults) {
        const history = historyMap[p.id] || [];
        let currentName = getCurrentNameFromHistory(history) || p.name;
        let currentRank = null;

        // Check Live Leaderboard
        if (liveMap.has(p.id)) {
            const liveEntry = liveMap.get(p.id);
            currentName = liveEntry.name;
            currentRank = liveEntry.rank;
        }

        enrichedResults.push({
            id: p.id,
            name: currentName,
            currentRank: currentRank,
            history: history
        });
    }

    if (format === 'text') {
        const textOutput = formatSearchTextOutput(enrichedResults);
        return c.text(textOutput);
    }

    return c.json({ matches: enrichedResults });
}

export async function handleGetPlayerProfile(c) {
    const id = c.req.param("id");
    const qMonth = c.req.query("month");
    const qYear = c.req.query("year");

    if (!id) return c.json({ error: "No player ID" }, 400);

    const db = c.env.DB;

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
    const historyPromise = getPlayerHistory(db, id);

    // 2. Fetch Season Stats from D1 (New Table)
    // Calculate season boundaries
    const seasonStart = getSeasonStart(targetDate);
    const seasonEnd = getSeasonEnd(seasonStart);

    // Skip the first Tuesday (Reset Day) in the chart, as it belongs to the previous season's final data.
    const chartStart = new Date(seasonStart);
    chartStart.setUTCDate(chartStart.getUTCDate() + 1);

    const startDateStr = chartStart.toISOString().split('T')[0];
    const endDateStr = seasonEnd.toISOString().split('T')[0];

    // Fetch stats from D1
    const d1StatsPromise = getPlayerStatsRange(db, id, startDateStr, endDateStr);

    // 3. Historical Season Ends
    // We now fetch these from D1 in one batch!
    const historicalKeys = getHistoricalSeasonEndKeys();
    const historicalDates = historicalKeys.map(k => k.date);

    // Parallel fetch: everything needed for the profile
    const [history, d1Stats, d1HistoricalResults, { map: liveMap }] = await Promise.all([
        historyPromise,
        d1StatsPromise,
        getPlayerHistoricalRanks(db, id, historicalDates),
        getLiveLeaderboardData()
    ]);

    // Format D1 stats for the frontend
    const currentSeasonStats = d1Stats.map(s => ({
        date: s.date,
        rank: s.rank,
        sp: s.score
    }));

    // Process Historical Ranks from D1
    const historicalRanks = d1HistoricalResults.map(r => {
        const keyInfo = historicalKeys.find(k => k.date === r.date);
        return {
            season: keyInfo ? keyInfo.seasonName : r.date,
            rank: r.rank,
            sp: r.sp
        };
    });


    const currentName = getCurrentNameFromHistory(history);

    // 4. Get Live Stats (Rank/SP) if available
    let currentRank = null;
    let currentSP = null;
    let finalName = currentName;

    if (liveMap.has(id)) {
        const liveData = liveMap.get(id);
        currentRank = liveData.rank;
        currentSP = liveData.score;
        finalName = liveData.name;
    }

    if (finalName === "Unknown" && !history) {
        return c.json({ error: "Player not found" }, 404);
    }

    return c.json({
        id: id,
        name: finalName,
        currentRank,
        currentSP,
        history: history || [],
        currentSeasonStats,
        historicalSeasonRanks: historicalRanks
    });
}
