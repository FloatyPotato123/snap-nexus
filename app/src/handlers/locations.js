import { logError } from '../utils/errors.js';

/**
 * GET /api/locations/hot
 * 
 * Scrapes snap.fan/news/schedule/?tab=locations to provide real-time
 * hot/featured location information for Twitch commands.
 * 
 * URL for Nightbot:
 * !addcom !hot $(urlfetch https://.../api/locations/hot)
 * 
 * Output Example: Hot Location: F.E.A.S.T. (...) | Next: Chronosphere Sphinx (in 3 days)
 */
const LOCATIONS_CACHE_KEY = "hot_locations_schedule_v1";
const CACHE_TTL = 3600 * 6; // 6 hours

export async function handleGetHotLocation(c) {
    try {
        const scheduleUrl = 'https://snap.fan/news/schedule/?tab=locations';
        
        // 1. Try KV Cache first
        if (c.env && c.env.MARVEL_SNAP_HUB) {
            const cached = await c.env.MARVEL_SNAP_HUB.get(LOCATIONS_CACHE_KEY, { type: "json" });
            if (cached) {
                console.log("Using cached hot locations data.");
                return respondWithSchedule(c, cached);
            }
        }

        // 2. Fetch Fresh
        const res = await fetch(scheduleUrl, {
            cf: {
                cacheEverything: true,
                cacheTtl: 3600 // Browser/Edge cache for 1 hour
            }
        });

        if (!res.ok) {
            return c.text('Error fetching schedule from Snap.fan.');
        }

        const html = await res.text();
        const regex = /(\d{2}\/\d{2}\/\d{4}).*?>(.*?)<\/a>( - (.*?))?<\/li>/g;
        let match;
        const schedule = [];

        while ((match = regex.exec(html)) !== null) {
            const [_, dateStr, name, __, desc] = match;
            const [m, d, y] = dateStr.split('/').map(Number);
            const startTime = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
            schedule.push({
                name: cleanup(name),
                desc: cleanup(desc || ''),
                startTime: startTime.toISOString() // Store as ISO for JSON
            });
        }

        if (schedule.length === 0) {
            return c.text('No upcoming locations found in schedule.');
        }

        // 3. Save to KV
        if (c.env && c.env.MARVEL_SNAP_HUB) {
            await c.env.MARVEL_SNAP_HUB.put(LOCATIONS_CACHE_KEY, JSON.stringify(schedule), {
                expirationTtl: CACHE_TTL
            });
        }

        return respondWithSchedule(c, schedule);

    } catch (error) {
        logError('[Hot Location API]', error);
        return c.text('Error parsing location schedule.');
    }
}

/**
 * Helper to process the schedule and return the response.
 */
function respondWithSchedule(c, schedule) {
    const now = new Date();
    // Re-parse dates if they came from JSON
    const parsedSchedule = schedule.map(s => ({
        ...s,
        startTime: new Date(s.startTime)
    }));

    parsedSchedule.sort((a, b) => a.startTime - b.startTime);
    
    let current = null;
    let next = null;

    for (let i = 0; i < parsedSchedule.length; i++) {
        const item = parsedSchedule[i];
        const duration = 24 * 60 * 60 * 1000; 
        const endTime = new Date(item.startTime.getTime() + duration);

        if (now >= item.startTime && now < endTime) {
            current = item;
            next = findNextSignificant(parsedSchedule, i);
            break;
        }
        if (now < item.startTime) {
            next = item;
            break;
        }
    }

    if (!current && !next) {
        return c.text('No current or upcoming locations found.');
    }

    const format = c.req.query('format') || 'json';

    if (format === 'text') {
        let parts = [];
        if (current) {
            parts.push(`Hot Location: ${current.name}${current.desc ? ` (${current.desc})` : ''}`);
        } else {
            parts.push('No Hot Location active right now.');
        }

        if (next) {
            parts.push(`Next: ${next.name}${next.desc ? ` (${next.desc})` : ''}`);
        }

        return c.text(parts.join(' | '));
    }

    return c.json({ current, next });
}

function cleanup(str) {
    return str.replace(/<[^>]*>/g, '')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

function findNextSignificant(schedule, currentIndex) {
    for (let i = currentIndex + 1; i < schedule.length; i++) {
        // Skip if same day (unlikely but safe)
        if (schedule[i].startTime.getTime() > schedule[currentIndex].startTime.getTime() + 12 * 60 * 60 * 1000) {
            return schedule[i];
        }
    }
    return null;
}
