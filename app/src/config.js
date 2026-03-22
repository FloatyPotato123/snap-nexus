/**
 * Application Configuration
 * 
 * Centralized configuration for the Snap Nexus application.
 * All magic numbers, URLs, and configuration values should be defined here.
 */

// ============================================================================
// API Configuration
// ============================================================================

/**
 * Leaderboard API endpoint template
 * @param {number} month - Month (1-12)
 * @param {number} year - Full year (e.g., 2025)
 * @returns {string} Full API URL
 */
export const getLeaderboardApiUrl = (month, year) =>
    `https://marvelsnap.com/wp-json/api/v1/leaderboard?month=${month}&year=${year}&region=global`;

// ============================================================================
// Cache Configuration
// ============================================================================

/**
 * Cache TTL for live leaderboard data (in milliseconds)
 * Default: 1 minute
 */
export const LIVE_LEADERBOARD_CACHE_TTL_MS = 60 * 1000;

// ============================================================================
// Database Configuration
// ============================================================================

/**
 * Maximum number of players to process in a single database batch operation
 * Prevents hitting SQLite bind limits and Worker sub-request limits
 */
export const DB_BATCH_SIZE_PLAYERS = 50;

/**
 * Maximum number of player stats to insert in a single batch
 * Stays under the 1000 sub-request limit per Worker invocation
 */
export const DB_BATCH_SIZE_STATS = 500;

/**
 * Maximum number of search results to return
 */
export const SEARCH_RESULT_LIMIT_DEFAULT = 20;

/**
 * Minimum query length for player search
 */
export const SEARCH_MIN_QUERY_LENGTH = 2;

// ============================================================================
// Season Configuration
// ============================================================================

/**
 * First month we have data for (0-indexed: 9 = October)
 */
export const DATA_START_MONTH = 9;

/**
 * First year we have data for
 */
export const DATA_START_YEAR = 2025;

/**
 * Season reset time (UTC hours)
 * Seasons reset at 7 PM UTC (19:00)
 */
export const SEASON_RESET_HOUR_UTC = 19;

/**
 * Buffer window after season reset (in minutes)
 * During this window, the scraper captures the previous season's final state
 */
export const SEASON_ROLLOVER_BUFFER_MINUTES = 15;

// ============================================================================
// Leaderboard Configuration
// ============================================================================

/**
 * KV key for rolling 24-hour SP history
 */
export const ROLLING_HISTORY_KV_KEY = 'leaderboard:rolling_24h';

/**
 * KV key for currently flagged name collisions (names shared by multiple players)
 */
export const ROLLING_COLLISIONS_KV_KEY = 'leaderboard:collisions';

/**
 * Frequency of rolling updates (in minutes)
 */
export const ROLLING_HISTORY_FREQUENCY_MINS = 5;

/**
 * Number of intervals to store for a rolling 24-hour window
 */
export const ROLLING_HISTORY_SIZE = (24 * 60) / ROLLING_HISTORY_FREQUENCY_MINS;

/**
 * Cron schedules for triggered events
 */
export const CRON_SCHEDULES = {
    ROLLING_UPDATE: "*/5 * * * *",
    DAILY_SNAPSHOT: "0 19 * * *"
};

/**
 * Number of top gainers/losers to show
 */
export const TOP_MOVERS_LIMIT = 50;

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
    QUERY_TOO_SHORT: 'Please provide a name (min 2 chars).',
    PLAYER_NOT_FOUND: 'Player not found',
    NO_PLAYER_ID: 'No player ID',
    MISSING_DATE_PARAMS: 'Missing parameters. Use ?year=YYYY&month=MM&day=DD',
    MISSING_COMPARISON_DATES: 'Missing date1 or date2',
    DATA_NOT_FOUND: 'No data found for this date.',
    FETCH_FAILED: 'Failed to fetch data.',
    LEADERBOARD_ERROR: 'Failed to fetch live leaderboard.',
    INIT_FAILED: 'Init Crash',
    LOAD_FAILED: 'Load Error',
    SEASON_LOAD_FAILED: 'Failed to load season',
    NO_CHART_TO_COPY: 'No chart to copy',
    COPY_FAILED: 'Could not copy'
};
