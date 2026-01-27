import { searchPlayers, getPlayerHistory } from '../utils/db.js';
import { getCurrentSeason } from '../utils/seasons.js';
import { getSeasonDailyKeys, getHistoricalSeasonEndKeys } from './history.js';

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
    // Dynamic import to avoid circular dependency issues if any, though standard import works if careful.
    // referencing the same file structure as handleGetPlayerProfile
    const { map: liveMap } = await import('./leaderboard.js').then(m => m.getLiveLeaderboardData());

    // 3. Hydrate with History & Live Data
    const enrichedResults = [];
    for (const p of uniqueResults) {
        const history = await getPlayerHistory(db, p.id);
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
            currentRank: currentRank, // API clients like search.js use this
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

    // 2. Fetch Season Stats (Daily)
    const seasonKeys = getSeasonDailyKeys(targetDate);
    // Use c.env.MARVEL_SNAP_HUB directly for KV
    const seasonPromises = seasonKeys.map(k => c.env.MARVEL_SNAP_HUB.get(k.key, { type: 'json' }).then(data => ({ date: k.date, data })));

    // 3. Fetch Historical Season Ends
    const historicalKeys = getHistoricalSeasonEndKeys();
    const historyRankPromises = historicalKeys.map(k => c.env.MARVEL_SNAP_HUB.get(k.key, { type: 'json' }).then(data => ({ date: k.date, label: k.seasonName, data })));

    const [history, ...allResults] = await Promise.all([historyPromise, ...seasonPromises, ...historyRankPromises]);

    // Split results back out
    const seasonResults = allResults.slice(0, seasonKeys.length);
    const historyRankResults = allResults.slice(seasonKeys.length);

    if (!history || history.length === 0) {
        // Fallback: If no history in D1, try to find in current leaderboard
        // This can happen if scraper hasn't run or indexing is slightly behind live
    }

    // Process Current Season Stats
    const currentSeasonStats = seasonResults
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

    // Get Live Stats (Rank/SP) if available
    const { map: liveMap } = await import('./leaderboard.js').then(m => m.getLiveLeaderboardData());
    let currentRank = null;
    let currentSP = null;
    let finalName = currentName; // Default

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
