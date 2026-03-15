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
export async function handleGetHotLocation(c) {
    try {
        const scheduleUrl = 'https://snap.fan/news/schedule/?tab=locations';
        
        // Use Cloudflare cache to avoid slamming snap.fan and stay within CPU limits
        const res = await fetch(scheduleUrl, {
            cf: {
                cacheEverything: true,
                cacheTtl: 3600 // Cache for 1 hour
            }
        });

        if (!res.ok) {
            return c.text('Error fetching schedule from Snap.fan.');
        }

        const html = await res.text();

        // Regex to extract date, name, and description from snap.fan's list format
        // Example: <li>03/08/2026 <a ...>F.E.A.S.T.</a> - Description</li>
        // Note: We use a more relaxed regex as snap.fan's HTML can vary slightly
        const regex = /(\d{2}\/\d{2}\/\d{4}).*?>(.*?)<\/a>( - (.*?))?<\/li>/g;
        let match;
        const schedule = [];
        const now = new Date();

        while ((match = regex.exec(html)) !== null) {
            const [_, dateStr, name, __, desc] = match;
            const [m, d, y] = dateStr.split('/').map(Number);
            
            // Marvel Snap locations typically start at 03:00 UTC
            const startTime = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
            schedule.push({
                name: cleanup(name),
                desc: cleanup(desc || ''),
                startTime
            });
        }

        if (schedule.length === 0) {
            // Fallback: If li parsing fails, try a broader search for dates
            return c.text('No upcoming locations found in schedule.');
        }

        // Identify current and next
        schedule.sort((a, b) => a.startTime - b.startTime);
        
        let current = null;
        let next = null;

        for (let i = 0; i < schedule.length; i++) {
            const item = schedule[i];
            // Featured locations last 48h, Hot last 24h. 
            // We'll assume 24h for simplicity unless we can detect "Featured"
            const duration = 24 * 60 * 60 * 1000; 
            const endTime = new Date(item.startTime.getTime() + duration);

            if (now >= item.startTime && now < endTime) {
                current = item;
                next = findNextSignificant(schedule, i);
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

    } catch (error) {
        logError('[Hot Location API]', error);
        return c.text('Error parsing location schedule.');
    }
}

function cleanup(str) {
    return str.replace(/<[^>]*>/g, '').trim();
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
