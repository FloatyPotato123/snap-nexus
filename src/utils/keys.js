/**
 * Centralized logic for generating Cloudflare KV keys.
 * Ensures consistency between scraper (writer) and API (reader).
 */

/**
 * Returns the KV key for a daily leaderboard snapshot.
 * Format: leaderboard_YYYY-MM-DD
 * @param {Date|string} date - Date object or date string
 * @returns {string} e.g. "leaderboard_2025-10-19"
 */
export function getLeaderboardKey(date) {
    const d = new Date(date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `leaderboard_${year}-${month}-${day}`;
}

/**
 * Returns the KV key for a player's history list.
 * Format: history:PLAYER_ID
 * @param {string} id - Player ID
 * @returns {string} e.g. "history:12345"
 */
export function getPlayerHistoryKey(id) {
    return `history:${id}`;
}

/**
 * Returns the KV key for the name-to-ID map.
 * Format: map:LOWERCASE_NAME
 * @param {string} name - Player Name
 * @returns {string} e.g. "map:specimen"
 */
export function getPlayerMapKey(name) {
    return `map:${name.trim().toLowerCase()}`;
}
