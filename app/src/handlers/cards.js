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
    const grouped = {};

    // 1. Group cards by day once
    const addToList = (list) => (list || []).forEach(c => {
        const d = c.releaseDate ? new Date(c.releaseDate).toISOString().split('T')[0] : "Unknown";
        if (!grouped[d]) grouped[d] = [];
        grouped[d].push(c);
    });
    addToList(thisWeek);
    addToList(nextWeek);

    const dates = Object.keys(grouped).sort();
    if (dates.length === 0) return "No cards found.";

    // 2. Render
    return dates.map(d => {
        // e.g. "Tue Feb 10: Card A [1/2]"
        const header = new Date(d).toLocaleDateString("en-US", { weekday: 'short', month: 'short', day: '2-digit', timeZone: 'UTC' });
        const cards = grouped[d].map(c => `${c.name} [${c.cost}/${c.power}]`).join(" | ");
        return `${header}: ${cards}`;
    }).join(" • ");
}

function cleanDesc(desc) {
    return (desc || "").replace(/<[^>]*>/g, "");
}
