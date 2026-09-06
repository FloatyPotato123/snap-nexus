import { logError } from '../utils/errors.js';
import { getAllLocationsUntapped } from './untapped_api.js';

/**
 * GET /api/locations/hot
 * 
 * Returns current hot/featured location and upcoming ones.
 * Enriched with Untapped.gg artwork and metadata.
 * 
 * URL for Nightbot:
 * !addcom !hot $(urlfetch https://<YOUR_WORKER_URL>/api/locations/hot?format=text)
 * 
 * Output Example: Hot Location: F.E.A.S.T. (...) | Next: Chronosphere Sphinx (in 3 days)
 */
const LOCATIONS_CACHE_KEY = "hot_locations_schedule_v4";
const CACHE_TTL = 3600 * 6; // 6 hours

export async function handleGetHotLocation(c) {
    try {
        const scheduleUrl = 'https://snap.fan/news/schedule/?tab=locations';
        
        // 1. Try KV Cache first
        if (c.env && c.env.MARVEL_SNAP_HUB) {
            const cached = await c.env.MARVEL_SNAP_HUB.get(LOCATIONS_CACHE_KEY, { type: "json" });
            if (cached) return await respondWithSchedule(c, cached);
        }

        // 2. Fetch Fresh Schedule from Snap.fan
        const res = await fetch(scheduleUrl);
        if (!res.ok) return c.text('Error fetching schedule.');

        const html = await res.text();
        const rawSchedule = parseSnapFanSchedule(html);

        // 3. Enrich with Untapped Metadata
        const untappedLocations = await getAllLocationsUntapped(c.env);
        const enrichedSchedule = rawSchedule.map(s => {
            const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const sNameNorm = normalize(s.name);
            const uLoc = untappedLocations.find(l => normalize(l.name) === sNameNorm);
            
            return {
                ...s,
                description: uLoc ? uLoc.description : s.desc,
                art: uLoc ? uLoc.art : `https://snapjson.untapped.gg/art/loc/${s.name.replace(/[^a-zA-Z]/g, '')}.webp`,
                defId: uLoc ? uLoc.cardDefId : s.name.replace(/[^a-zA-Z]/g, '')
            };
        });

        // 4. Save to KV Cache if entries found
        if (enrichedSchedule.length > 0 && c.env && c.env.MARVEL_SNAP_HUB) {
            await c.env.MARVEL_SNAP_HUB.put(LOCATIONS_CACHE_KEY, JSON.stringify(enrichedSchedule), { expirationTtl: CACHE_TTL });
        }

        return await respondWithSchedule(c, enrichedSchedule);

    } catch (error) {
        logError('[Hot Location API]', error);
        return c.text('Error processing location schedule.');
    }
}

async function respondWithSchedule(c, schedule) {
    const now = new Date();
    const parsed = schedule.map(s => ({ ...s, startTime: new Date(s.startTime) }));
    parsed.sort((a, b) => a.startTime - b.startTime);
    
    let current = null;
    const upcoming = [];

    for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        const endTime = new Date(item.startTime.getTime() + (24 * 60 * 60 * 1000));

        if (now >= item.startTime && now < endTime) {
            current = item;
        } else if (now < item.startTime) {
            if (upcoming.length < 3) upcoming.push(item);
        }
    }

    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    
    // Standard Hot/Featured Windows (Sunday/Wednesday 19:00 UTC)
    let isHotDay = ((day === 0 && hour >= 19) || (day === 1 && hour < 19)) ||
                     ((day === 3 && hour >= 19) || (day === 4 && hour < 19));



    const format = c.req.query('format') || 'json';
    
    if (format === 'text') {
        let parts = [];
        if (current) {
            parts.push(`Hot Location: ${current.name}${current.description ? ` (${current.description})` : ''}`);
        } else {
            parts.push('No Hot Location active right now.');
        }

        const next = upcoming.length > 0 ? upcoming[0] : null;
        if (next) {
            parts.push(`Next: ${next.name}${next.description ? ` (${next.description})` : ''}`);
        }

        return c.text(parts.join(' | '));
    }

    return c.json({ 
        current: isHotDay ? current : null, 
        upcoming,
        isHotDay
    });
}

function parseSnapFanSchedule(html) {
    if (!html) return [];

    const monthNames = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };

    const rawSchedule = [];
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();

    // 1. Try Modern Astro Layout (grouped by data-month sections and spotlight-cards)
    const monthSections = html.split(/<section[^>]+data-month="([^"]+)"/g);
    if (monthSections.length > 1) {
        for (let i = 1; i < monthSections.length; i += 2) {
            const monthKey = monthSections[i]; // e.g. "2026-09"
            const sectionContent = monthSections[i + 1] || '';
            const [yearStr, monthNumStr] = monthKey.split('-');
            const defaultYear = parseInt(yearStr, 10) || currentYear;
            const defaultMonth = (parseInt(monthNumStr, 10) - 1) >= 0 ? parseInt(monthNumStr, 10) - 1 : currentMonth;

            // Extract locations tab section
            const locTabMatch = sectionContent.match(/data-tab="locations"[\s\S]*?(?:<div[^>]+data-tab=|<\/section)/i);
            const targetHtml = locTabMatch ? locTabMatch[0] : sectionContent;

            const cards = targetHtml.split(/<div class="spotlight-card">/g).slice(1);
            for (const card of cards) {
                const dateMatch = card.match(/class="banner-date__dates">([^<]+)<\/span>/i) || card.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
                const nameMatch = card.match(/<a href="\/locations\/[^"]*"[^>]*>([^<]+)<\/a>/i);
                const descMatch = card.match(/<div class="[^"]*text-snap-gray-300[^"]*">([\s\S]*?)<\/div>/i);

                if (dateMatch && nameMatch) {
                    const rawDate = dateMatch[1].trim();
                    const rawName = nameMatch[1].trim();
                    const rawDesc = descMatch ? descMatch[1].trim() : '';

                    let startTime = null;
                    const textDateMatch = rawDate.match(/([a-zA-Z]+)\s+(\d{1,2})/);
                    if (textDateMatch) {
                        const mPrefix = textDateMatch[1].substring(0, 3).toLowerCase();
                        const mIndex = monthNames[mPrefix] !== undefined ? monthNames[mPrefix] : defaultMonth;
                        const day = parseInt(textDateMatch[2], 10);
                        startTime = new Date(Date.UTC(defaultYear, mIndex, day, 19, 0, 0));
                    } else if (rawDate.includes('/')) {
                        const parts = rawDate.split('/').map(Number);
                        if (parts.length === 3) {
                            startTime = new Date(Date.UTC(parts[2], parts[0] - 1, parts[1], 19, 0, 0));
                        } else if (parts.length === 2) {
                            startTime = new Date(Date.UTC(defaultYear, parts[0] - 1, parts[1], 19, 0, 0));
                        }
                    }

                    if (startTime && !isNaN(startTime.getTime())) {
                        rawSchedule.push({
                            name: cleanup(rawName),
                            desc: cleanup(rawDesc),
                            startTime: startTime.toISOString()
                        });
                    }
                }
            }
        }
    }

    return rawSchedule;
}

function cleanup(str) {
    if (!str) return '';
    return str.replace(/<[^>]*>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&ldquo;/g, '"')
        .replace(/&rdquo;/g, '"')
        .replace(/&amp;/g, '&')
        .trim();
}
