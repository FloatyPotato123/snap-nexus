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
