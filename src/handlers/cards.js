import { getAllCards } from "snapdeck";

/**
 * Calculates the start of the current "Marvel Snap Week" (Tuesday 19:00 UTC).
 * If currently older than Tuesday 19:00 UTC, it returns the *previous* Tuesday.
 */
function getSnapWeekStart() {
    const now = new Date();
    const currentDay = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const currentHour = now.getUTCHours();

    // Marvel Snap reset is Tuesday (2) at 19:00 UTC
    // We want to find the most recent Tuesday 19:00 that has passed.

    let daysSinceTuesday = currentDay - 2;
    if (daysSinceTuesday < 0) daysSinceTuesday += 7;

    // If today is Tuesday, check if we passed 19:00 UTC
    if (daysSinceTuesday === 0 && currentHour < 19) {
        daysSinceTuesday = 7; // Treat as previous week
    }

    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - daysSinceTuesday);
    weekStart.setUTCHours(19, 0, 0, 0); // 19:00:00.000 UTC

    return weekStart;
}

export async function getWeeklyCardReleases(c) {
    try {
        const allCards = await getAllCards();

        // Time Ranges
        const thisWeekStart = getSnapWeekStart();
        const nextWeekStart = new Date(thisWeekStart);
        nextWeekStart.setUTCDate(thisWeekStart.getUTCDate() + 7);

        const nextWeekEnd = new Date(nextWeekStart);
        nextWeekEnd.setUTCDate(nextWeekStart.getUTCDate() + 7);

        // Arrays to hold results
        const thisWeekCards = [];
        const nextWeekCards = [];

        allCards.forEach(card => {
            // Filter: Must be obtainable
            if (!card.obtainable || !card.releaseDate) return;

            const releaseDate = new Date(card.releaseDate);

            // Check ranges
            if (releaseDate >= thisWeekStart && releaseDate < nextWeekStart) {
                thisWeekCards.push(card);
            } else if (releaseDate >= nextWeekStart && releaseDate < nextWeekEnd) {
                nextWeekCards.push(card);
            }
        });

        // Helper to format output
        const formatCard = (card) => {
            let dateStr = "";
            try {
                if (card.releaseDate) {
                    dateStr = new Date(card.releaseDate).toISOString().split('T')[0];
                }
            } catch (ignore) {
                dateStr = String(card.releaseDate);
            }
            return {
                name: card.name,
                cost: card.cost,
                power: card.power,
                releaseDate: dateStr,
                obtainable: true,
                description: card.description,
                source: card.source
            };
        };

        // Check for format query (default: json, optional: text)
        const format = c.req.query('format') || 'json';

        if (format === 'text') {
            return c.text(formatCardScheduleText(thisWeekCards, nextWeekCards));
        }

        // Default: JSON Response
        return c.json({
            weekStart: thisWeekStart.toISOString(),
            thisWeek: thisWeekCards.map(formatCard),
            nextWeek: nextWeekCards.map(formatCard)
        });

    } catch (e) {
        return c.text(`Error: Failed to fetch card releases. (${e.message})`, 500);
    }
}

/**
 * Formats the weekly card schedule into a Nightbot-safe text block (<400 chars).
 * 
 * Twitch Command: !newcards
 * Output Example:
 * Jan 20
 * Fin Fang Foom | 7/12 | On Reveal: Gain the Power of front-row enemy cards here.
 * 
 * Jan 27
 * Shang-Chi, Master of the Rings | 3/5 | Game Start: The Ten Rings starts in your hand.
 */
function formatCardScheduleText(thisWeek, nextWeek) {
    const MAX_TOTAL_CHARS = 400;
    const allCards = [];

    // 1. Flatten and Prepare
    const prep = (list) => {
        if (!list) return;
        list.forEach(c => {
            let d = "Unknown";
            try { d = new Date(c.releaseDate).toISOString().split('T')[0]; } catch (e) { }
            allCards.push({ ...c, dateKey: d });
        });
    };
    prep(thisWeek);
    prep(nextWeek);

    if (allCards.length === 0) return "No cards found.";

    // 2. Calculate Overhead
    // Unique Dates (8 chars each) + Fixed Card Data
    const uniqueDates = new Set(allCards.map(c => c.dateKey));
    let fixedCost = (uniqueDates.size * 8); // "Jan 06\n" is ~7-8 chars

    allCards.forEach(c => {
        // "Name | Cost/Power | \n" (+7 chars separation)
        fixedCost += (c.name?.length || 0) + `${c.cost}/${c.power}`.length + 7;
    });

    // 3. Determine Budget
    let descBudget = Math.max(0, MAX_TOTAL_CHARS - fixedCost);

    // 4. Calculate Proportions
    const totalDescLen = allCards.reduce((sum, c) => sum + cleanDesc(c.description).length, 0);

    // 5. Render
    const renderList = (list) => {
        if (!list || list.length === 0) return "None";
        const grouped = {};
        list.forEach(c => {
            let d = "Unknown";
            try { d = new Date(c.releaseDate).toISOString().split('T')[0]; } catch (e) { }
            if (!grouped[d]) grouped[d] = [];
            grouped[d].push(c);
        });

        return Object.keys(grouped).sort().map(dateKey => {
            const dateHeader = new Date(dateKey).toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
            const cardsStr = grouped[dateKey].map(c => {
                let text = cleanDesc(c.description);

                // Apply Truncation
                if (totalDescLen > descBudget && descBudget > 0) {
                    const ratio = text.length / totalDescLen;
                    const allow = Math.floor(descBudget * ratio);
                    if (text.length > allow) {
                        text = text.substring(0, Math.max(0, allow - 3)) + "...";
                    }
                } else if (descBudget <= 0) {
                    text = "";
                }

                // Clean up trailing separators if description is empty
                return `${c.name} [${c.cost}/${c.power}]${text ? ': ' + text : ''}`;
            }).join(" | ");

            return `${dateHeader}: ${cardsStr}`;
        }).join(" // ");
    };

    return `${renderList(thisWeek)} // ${renderList(nextWeek)}`.trim();
}

function cleanDesc(desc) {
    return (desc || "").replace(/<[^>]*>/g, "");
}
