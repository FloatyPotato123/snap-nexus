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
            // Format as Plain Text

            // Helper to render a section (this week / next week) grouped by date
            const renderSection = (cardList) => {
                if (!cardList || cardList.length === 0) return "None";

                // Group by Date string (YYYY-MM-DD for sorting)
                const grouped = {};
                cardList.forEach(c => {
                    let d = "Unknown Date";
                    try {
                        d = new Date(c.releaseDate).toISOString().split('T')[0];
                    } catch (e) { d = String(c.releaseDate); }

                    if (!grouped[d]) grouped[d] = [];
                    grouped[d].push(c);
                });

                // Sort dates
                const sortedDates = Object.keys(grouped).sort();

                let sectionOutput = "";
                sortedDates.forEach(dateKey => {
                    // Header: "Dec 30"
                    const dObj = new Date(dateKey);
                    const header = dObj.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });

                    sectionOutput += `${header}\n`;

                    // Cards
                    grouped[dateKey].forEach(c => {
                        // Clean HTML from description
                        let cleanDesc = (c.description || "").replace(/<[^>]*>/g, "");

                        // Truncate description for chat bots
                        const MAX_DESC = 100;
                        if (cleanDesc.length > MAX_DESC) {
                            cleanDesc = cleanDesc.substring(0, MAX_DESC) + "...";
                        }

                        sectionOutput += `${c.name} | ${c.cost}/${c.power} | ${cleanDesc}\n`;
                    });
                    sectionOutput += "\n";
                });

                return sectionOutput.trim();
            };

            let output = "This week:\n";
            output += renderSection(thisWeekCards);

            output += "\n\nNext week:\n";
            output += renderSection(nextWeekCards);

            return c.text(output);
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
