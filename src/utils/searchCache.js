/**
 * In-memory cache for player name keys to enable fuzzy searching.
 * Caches the list of "map:" keys from KV.
 */

let playerKeyCache = {
    timestamp: 0,
    keys: []
};
const KEY_CACHE_TTL = 30 * 60 * 1000; // 30 Minutes

export async function refreshPlayerKeyCache(kv) {
    const now = Date.now();
    if (now - playerKeyCache.timestamp < KEY_CACHE_TTL && playerKeyCache.keys.length > 0) {
        return playerKeyCache.keys;
    }


    try {
        let keys = [];
        let cursor = undefined;
        let hasMore = true;

        while (hasMore && keys.length < 10000) {
            const list = await kv.list({ prefix: "map:", limit: 1000, cursor });
            keys.push(...list.keys.map(k => k.name));

            if (list.list_complete) hasMore = false;
            else cursor = list.cursor;
        }

        playerKeyCache = { timestamp: now, keys };
        return keys;
    } catch (e) {
        return playerKeyCache.keys;
    }
}
