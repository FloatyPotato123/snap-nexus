/**
 * Shared logic for calculating Marvel Snap season dates and API parameters.
 */

/**
 * Gets a season by ID from the global cache if available.
 * @param {string} seasonId - e.g., "2026-07"
 * @returns {{season_id: string, start_date: string, end_date: string}|null}
 */
function getCachedSeason(seasonId) {
    if (globalThis.SEASONS_CACHE && Array.isArray(globalThis.SEASONS_CACHE)) {
        return globalThis.SEASONS_CACHE.find(s => s.season_id === seasonId) || null;
    }
    return null;
}

/**
 * Calculates the start date of a Marvel Snap season (First Tuesday) for a given month.
 * @param {number} year - Full year (e.g., 2025)
 * @param {number} monthIndex - Month index (0-11)
 * @returns {Date} The Date object representing the first Tuesday of the month (UTC).
 */
export function getSeasonStartForMonth(year, monthIndex) {
    const seasonId = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const cached = getCachedSeason(seasonId);
    if (cached) {
        return new Date(cached.start_date);
    }

    // Override for July 2026 season which started on June 30, 2026
    if (year === 2026 && monthIndex === 6) {
        return new Date(Date.UTC(2026, 5, 30)); // June 30, 2026
    }

    const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
    let day = 1;
    let currentDay = new Date(firstOfMonth);

    // Find the first Tuesday (2)
    while (currentDay.getUTCDay() !== 2) {
        day++;
        currentDay = new Date(Date.UTC(year, monthIndex, day));
    }
    return currentDay;
}

/**
 * Helper to get the season start date for a specific date object.
 * This effectively normalizes any date to its "Season Start".
 * @param {Date|string} date 
 * @returns {Date}
 */
export function getSeasonStart(date) {
    const { year, month } = getCurrentSeason(new Date(date));
    return getSeasonStartForMonth(year, month - 1);
}

/**
 * Calculates the end date of a season (Day before the next season starts).
 * @param {Date} date - Any date within the season
 * @returns {Date} The season end date.
 */
export function getSeasonEnd(date) {
    const { year, month } = getCurrentSeason(new Date(date));
    let nextMonth = month; // Since month is 1-indexed, this is the 0-indexed month index of the next month
    let nextYear = year;
    if (nextMonth > 11) {
        nextMonth = 0;
        nextYear++;
    }
    return getSeasonStartForMonth(nextYear, nextMonth);
}

/**
 * Calculates the end date of a season (Day before the next season starts) from a Month Index.
 * @param {number} year - Full year
 * @param {number} monthIndex - Month index (0-11)
 * @returns {Date} The season end date.
 */
export function getSeasonEndForMonth(year, monthIndex) {
    const seasonId = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const cached = getCachedSeason(seasonId);
    if (cached) {
        return new Date(cached.end_date);
    }

    // Season End is the reset day itself
    let nextM = monthIndex + 1;
    let nextY = year;
    if (nextM > 11) { nextM = 0; nextY++; }

    const nextStart = getSeasonStartForMonth(nextY, nextM);
    return new Date(nextStart);
}

/**
 * Returns the "Active" Season Month/Year, accounting for the 19:00 UTC rollover.
 * @param {Date} now - Current date
 * @returns {{year: number, month: number}} 1-indexed Month (1=Jan)
 */
export function getCurrentSeason(now) {
    const nowTime = now.getTime();

    // 1. Try to find the active season in the global cache
    if (globalThis.SEASONS_CACHE && Array.isArray(globalThis.SEASONS_CACHE)) {
        const active = globalThis.SEASONS_CACHE.find(s => {
            const start = new Date(s.start_date).getTime();
            const end = new Date(s.end_date).getTime();
            return nowTime >= start && nowTime < end;
        });
        if (active) {
            const [y, m] = active.season_id.split('-').map(Number);
            return { year: y, month: m };
        }
    }


    // 2. Fallback to programmatic calculation
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth(); // 0-indexed

    // Check if we have already crossed into the next month's season start (for early rollover seasons)
    let nextMonth = month + 1;
    let nextYear = year;
    if (nextMonth > 11) { nextMonth = 0; nextYear++; }
    const nextSeasonStart = getSeasonStartForMonth(nextYear, nextMonth);
    const nextGraceTime = new Date(nextSeasonStart);
    nextGraceTime.setUTCHours(19);

    if (now >= nextGraceTime) {
        return { year: nextYear, month: nextMonth + 1 };
    }

    // Otherwise, check if we are before the current month's season start
    const seasonStart = getSeasonStartForMonth(year, month);
    const graceTime = new Date(seasonStart);
    graceTime.setUTCHours(19);

    if (now < graceTime) {
        month--;
        if (month < 0) { month = 11; year--; }
    }

    return { year, month: month + 1 }; // Return 1-indexed for easy usage
}

