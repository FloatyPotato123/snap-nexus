import { getLeaderboardApiUrl, LIVE_LEADERBOARD_CACHE_TTL_MS } from '../config.js';
import { getCurrentSeason } from './seasons.js';
import { logError } from './errors.js';

let liveLeaderboardCache = { timestamp: 0, data: new Map(), total: 0, collisions: new Set() };

/**
 * Fetches live Top 1000 ranks and global Infinite total from the official API.
 */
export async function getLiveLeaderboardData() {
    const now = Date.now();

    if (liveLeaderboardCache && now - liveLeaderboardCache.timestamp < LIVE_LEADERBOARD_CACHE_TTL_MS) {
        const c = liveLeaderboardCache;
        return { map: c.data, total: c.total, collisions: c.collisions };
    }

    const { year, month } = getCurrentSeason(new Date());
    const apiUrl = getLeaderboardApiUrl(month, year);

    try {
        const res = await fetch(apiUrl);

        if (!res.ok) {
            logError('[Leaderboard]', new Error(`API returned ${res.status}`));
            const c = liveLeaderboardCache || { data: new Map(), total: 0, collisions: new Set() };
            return { map: c.data, total: c.total, collisions: c.collisions };
        }

        const data = await res.json();
        const newMap = new Map();
        const collisions = new Set();
        const seenNames = new Set();

        if (data?.results) {
            data.results.forEach((entry, index) => {
                const rank = index + 1;
                const name = entry.playerName || entry.name;
                let id = String(entry.id || entry.playerId || '');
                
                if (name) {
                    if (seenNames.has(name)) {
                        collisions.add(name);
                    }
                    seenNames.add(name);
                }

                if (!id || id === 'undefined' || id === '') {
                    id = name;
                }

                newMap.set(id, {
                    id,
                    rank,
                    name,
                    score: entry.score
                });
            });
        }

        const globalTotal = data?.total || 0;
        liveLeaderboardCache = { timestamp: now, data: newMap, total: globalTotal, collisions };

        return { map: newMap, total: globalTotal, collisions };
    } catch (error) {
        logError('[Leaderboard]', error, { apiUrl });
        const c = liveLeaderboardCache || { data: new Map(), total: 0, collisions: new Set() };
        return { map: c.data, total: c.total, collisions: c.collisions };
    }
}
