/**
 * Shared logic for calculating Marvel Snap season dates and API parameters.
 */

/**
 * Calculates the start date of a Marvel Snap season (First Tuesday) for a given month.
 * @param {number} year - Full year (e.g., 2025)
 * @param {number} monthIndex - Month index (0-11)
 * @returns {Date} The Date object representing the first Tuesday of the month (UTC).
 */
export function getSeasonStartForMonth(year, monthIndex) {
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
 * Determines the correct API month/year for a snapshot date.
 * Snap seasons often start early in the month, so a date before the first Tuesday belongs to the previous "API Season".
 * @param {Date} snapshotDate - The date to check
 * @returns {{year: number, month: number}} The API compatible year and month (1-indexed).
 */


/**
 * Helper to get the season start date for a specific date object.
 * This effectively normalizes any date to its "Season Start".
 * @param {Date|string} date 
 * @returns {Date}
 */
export function getSeasonStart(date) {
    const d = new Date(date);
    d.setUTCDate(1); // 1st of month
    while (d.getUTCDay() !== 2) { // 2 = Tuesday
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return d;
}

/**
 * Calculates the end date of a season (Day before the next season starts).
 * @param {Date} date - Any date within the season
 * @returns {Date} The season end date.
 */
export function getSeasonEnd(date) {
    const seasonStart = getSeasonStart(date);
    const nextMonth = new Date(seasonStart);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const nextSeasonStart = getSeasonStart(nextMonth);

    // End on the reset day itself (to include the 19:00 final snapshot)
    return new Date(nextSeasonStart);
}

/**
 * Calculates the end date of a season (Day before the next season starts) from a Month Index.
 * @param {number} year - Full year
 * @param {number} monthIndex - Month index (0-11)
 * @returns {Date} The season end date.
 */
export function getSeasonEndForMonth(year, monthIndex) {
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
    // 1. Guess the season based on calendar month
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth(); // 0-indexed

    // Determine strict season start (First Tuesday of the month)
    const seasonStart = getSeasonStartForMonth(year, month);

    // Apply 19-hour grace period for API rollover (19:00 UTC)
    const graceTime = new Date(seasonStart);
    graceTime.setUTCHours(19);

    // Roll back to previous season if within grace period
    if (now < graceTime) {
        month--;
        if (month < 0) { month = 11; year--; }
    }

    return { year, month: month + 1 }; // Return 1-indexed for easy usage
}
