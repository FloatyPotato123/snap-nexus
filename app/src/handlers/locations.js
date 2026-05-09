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
const LOCATIONS_CACHE_KEY = "hot_locations_schedule_v2";
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
        const regex = /(\d{2}\/\d{2}\/\d{4}).*?>(.*?)<\/a>( - (.*?))?<\/li>/g;
        let match;
        const rawSchedule = [];

        while ((match = regex.exec(html)) !== null) {
            const [_, dateStr, name, __, desc] = match;
            const [m, d, y] = dateStr.split('/').map(Number);
            const startTime = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
            rawSchedule.push({
                name: cleanup(name),
                desc: cleanup(desc || ''),
                startTime: startTime.toISOString()
            });
        }

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
