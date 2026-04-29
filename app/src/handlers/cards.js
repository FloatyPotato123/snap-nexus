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

// --- Levenshtein Distance ---
function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function normalizeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Handle: !cardhistory
 * Twitch Setup: !addcom !cardhistory $(urlfetch https://<worker-domain>/api/cards/history?q=$(querystring))
 * Output Example: [5/24/22] 4/2 On Reveal: ... • [1/17/25] 2/4
 */
export async function handleCardHistory(c) {
    try {
        const query = c.req.query("q");
        if (!query) {
            return c.text("Error: Please provide a card name (!cardhistory <name>).");
        }

        const allCards = await getAllCards();
        const normalizedQuery = normalizeName(query);

        let bestMatch = null;
        let bestScore = Infinity;

        for (const card of allCards) {
            if (!card.name) continue;
            const normalizedCardName = normalizeName(card.name);
            
            // 1. Exact match
            if (normalizedCardName === normalizedQuery) {
                bestMatch = card;
                bestScore = 0;
                break;
            }

            // 2. Substring match
            if (normalizedCardName.includes(normalizedQuery)) {
                const score = (normalizedCardName.length - normalizedQuery.length) * 0.1;
                if (score < bestScore) {
                    bestScore = score;
                    bestMatch = card;
                }
                continue;
            }

            // 3. Typo match (allow prefix/word typos)
            // Instead of comparing against the whole name, check if it's close to any prefix
            const dist = levenshtein(normalizedQuery, normalizedCardName);
            if (dist < bestScore && dist <= 3) {
                bestScore = dist;
                bestMatch = card;
            }
            
            // 4. Also check against individual words (e.g. "ravona" vs "ravonna")
            const cardWords = card.name.toLowerCase().split(/[^a-z0-9]/).filter(Boolean);
            for (const word of cardWords) {
                const wordDist = levenshtein(normalizedQuery, word);
                if (wordDist < bestScore && wordDist <= 2) {
                    bestScore = wordDist;
                    bestMatch = card;
                }
            }
        }

        // Require a reasonable match score (e.g., max 3 typos for short words, or substring match)
        // If the best score is greater than 3, and the string is short, it's likely garbage.
        if (!bestMatch || bestScore > 3) {
            return c.text(`Card "${query}" not found. Please check spelling.`);
        }

        const cardDefId = bestMatch.cardDefId;
        const snapFanUrl = `https://snap.fan/cards/${cardDefId}/`;

        const res = await fetch(snapFanUrl);
        if (!res.ok) {
            return c.text(`Error: Could not fetch history for ${bestMatch.name} from snap.fan.`);
        }

        const html = await res.text();
        const historyMatch = html.match(/<h2 class="mt-4">History<\/h2>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
        
        if (!historyMatch) {
            return c.text(`No balance history found for ${bestMatch.name}.`);
        }

        const tbody = historyMatch[1];
        const rows = [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
        const history = [];

        rows.forEach(r => {
            const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1].trim());
            if (cells.length >= 4) {
                let date = cells[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                let isReleased = false;
                if (date.includes('Released')) {
                    date = date.replace('Released', '').trim();
                    isReleased = true;
                }
                
                // Shorten Date format YYYY-MM-DD -> M/D/YY
                try {
                    const [y, m, d] = date.split('-');
                    date = `${parseInt(m)}/${parseInt(d)}/${y.substring(2)}`;
                } catch(e) {}
                
                const cost = cells[1].replace(/<[^>]+>/g, '').trim();
                const power = cells[2].replace(/<[^>]+>/g, '').trim();
                
                let desc = cells[3].replace(/<\/?(div|p|br|li|ul)[^>]*>/gi, ' ')
                                   .replace(/<[^>]+>/g, '')
                                   .replace(/(?:[a-zA-Z]+)?=['"][^'"]*['"]>?/g, '') // remove orphaned attributes
                                   .replace(/AvX:[^\.]+\.?/ig, '') // removes any AvX sentence
                                   .replace(/\s+/g, ' ')
                                   .trim();
                // Extract "Curr:" part if it exists
                if (desc.includes("Curr:") && desc.includes("Prev:")) {
                    desc = desc.substring(desc.indexOf("Curr:") + 5, desc.indexOf("Prev:")).trim();
                }

                history.push({ date, cost, power, desc, isReleased });
            }
        });

        // We want from oldest (Release) to newest
        let releaseIndex = history.findIndex(h => h.isReleased);
        if (releaseIndex === -1) releaseIndex = history.length - 1; // Fallback to oldest available

        const rawValidHistory = history.slice(0, releaseIndex + 1).reverse();
        
        if (rawValidHistory.length === 0) {
            return c.text(`No valid history found for ${bestMatch.name}.`);
        }

        // Filter out minor rewords (but keep numerical/stat changes)
        const getNumbers = (str) => (str.match(/\d+/g) || []).join(',');
        const validHistory = [rawValidHistory[0]];
        
        for (let i = 1; i < rawValidHistory.length; i++) {
            const curr = rawValidHistory[i];
            const prev = validHistory[validHistory.length - 1];
            
            if (curr.cost !== prev.cost || curr.power !== prev.power) {
                validHistory.push(curr);
                continue;
            }
            
            if (getNumbers(curr.desc) !== getNumbers(prev.desc)) {
                validHistory.push(curr);
                continue;
            }
            
            const dist = levenshtein(prev.desc, curr.desc);
            const percentDiff = dist / Math.max(prev.desc.length, curr.desc.length, 1);
            
            if (percentDiff > 0.15) {
                validHistory.push(curr);
            }
        }

        const segments = validHistory.map((item, i) => {
            let changedDesc = false;
            let changedStats = false;
            if (i > 0) {
                const prev = validHistory[i-1];
                if (prev.cost !== item.cost || prev.power !== item.power) changedStats = true;
                if (prev.desc !== item.desc) changedDesc = true;
            } else {
                changedStats = true;
                changedDesc = true;
            }
            return {
                date: item.date,
                stats: changedStats ? `${item.cost}/${item.power}` : "",
                desc: changedDesc ? item.desc : ""
            };
        });

        // Calculate base length without descriptions
        let baseLen = segments.map(s => {
            let len = s.date.length + 2; // "[date]"
            if (s.stats) len += s.stats.length + 1; // " stats"
            return len;
        }).reduce((a, b) => a + b, 0);
        baseLen += (segments.length - 1) * 3; // " • "

        const descCount = segments.filter(s => s.desc.length > 0).length;
        let allowedDescLen = descCount > 0 ? Math.floor((390 - baseLen - (descCount * 2)) / descCount) : 0;
        if (allowedDescLen < 15) allowedDescLen = 15; 

        let lastTruncatedDesc = null;
        const parts = segments.map(s => {
            let p = `[${s.date}]`;
            if (s.stats) p += ` ${s.stats}`;
            if (s.desc) {
                let d = s.desc;
                if (d.length > allowedDescLen) {
                    d = d.substring(0, allowedDescLen).trim().replace(/\.+$/, '') + "…";
                }
                if (d === lastTruncatedDesc) {
                    p += ` (Text Updated)`;
                } else {
                    p += ` ${d}`;
                    lastTruncatedDesc = d;
                }
            }
            return p;
        });

        let output = parts.join(" • ");
        if (output.length > 400) {
            output = output.substring(0, 397) + "...";
        }
        
        return c.text(output);
        
    } catch (e) {
        console.error(e);
        return c.text(`Error: Failed to fetch card history. (${e.message})`);
    }
}
