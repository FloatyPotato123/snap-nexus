
/**
 * Utility to fetch and cache live card data from Untapped.gg.
 * Uses Cloudflare KV (MARVEL_SNAP_HUB) for caching.
 */

const UNTAPPED_CARDS_URL = "https://snapjson.untapped.gg/v2/latest/en/cards.json";
const UNTAPPED_LOCATIONS_URL = "https://snapjson.untapped.gg/v2/latest/en/locations.json";

const CARDS_CACHE_KEY = "untapped_cards_data_v1";
const LOCATIONS_CACHE_KEY = "untapped_locations_data_v1";
const CACHE_TTL = 3600 * 6; // 6 hours

/**
 * Normalizes Untapped card data to the format expected by the app.
 */
function normalizeCard(uCard) {
    // Map series to human readable source
    const seriesMap = {
        1: "Pool 1",
        2: "Pool 2",
        3: "Pool 3",
        4: "Pool 4",
        5: "Pool 5",
        6: "Pool 3", // Untapped often uses 6 for older pool 3
        7: "Pool 4", 
        8: "Pool 5",
        9: "Season Pass"
    };

    let source = seriesMap[uCard.series] || `Series ${uCard.series}`;
    if (uCard.isSeasonPass) source = "Season Pass";

    // Extract release date from timestamps (ms to ISO)
    let releaseDate = null;
    if (uCard.seriesStartTimestamps && uCard.seriesStartTimestamps.length > 0) {
        const ts = uCard.seriesStartTimestamps[0];
        if (ts > 0) {
            releaseDate = new Date(ts).toISOString();
        }
    }

    return {
        cid: uCard.defId,
        name: uCard.name,
        type: "Character", // Untapped doesn't explicitly state type in the same way, but most are characters
        cost: uCard.cost,
        power: uCard.power,
        description: cleanAbility(uCard.description || ""),
        flavor: "", 
        art: `https://snapjson.untapped.gg/art/render/framebreak/common/256/${uCard.defId}.webp`,
        url: `https://snap.untapped.gg/en/cards/${uCard.defId}`,
        status: releaseDate && new Date(releaseDate) <= new Date() ? "released" : "unreleased",
        cardDefId: uCard.defId,
        obtainable: uCard.collectible || false,
        releaseDate: releaseDate,
        source: source
    };
}

function cleanAbility(text) {
    if (!text) return "";
    return text
        .replace(/<[^>]*>/g, "") // Remove HTML tags
        .replace(/\n/g, " ")     // Replace newlines with spaces
        .replace(/\s+/g, " ")    // Collapse multiple spaces
        .trim();
}

/**
 * Fetches all cards from Untapped, using KV cache if available.
 */
export async function getAllCardsUntapped(env) {
    if (!env || !env.MARVEL_SNAP_HUB) {
        return await fetchFreshUntappedCards();
    }

    try {
        const cached = await env.MARVEL_SNAP_HUB.get(CARDS_CACHE_KEY, { type: "json" });
        if (cached && Array.isArray(cached)) {
            return cached;
        }
    } catch (e) {
        console.error("Failed to read Untapped cache:", e);
    }

    const fresh = await fetchFreshUntappedCards();
    
    if (fresh && fresh.length > 0) {
        try {
            await env.MARVEL_SNAP_HUB.put(CARDS_CACHE_KEY, JSON.stringify(fresh), {
                expirationTtl: CACHE_TTL
            });
        } catch (e) {
            console.error("Failed to write Untapped cache:", e);
        }
    }

    return fresh;
}

async function fetchFreshUntappedCards() {
    console.log("Fetching fresh cards from Untapped.gg...");
    try {
        const response = await fetch(UNTAPPED_CARDS_URL);
        
        if (!response.ok) {
            throw new Error(`Untapped API error: ${response.status}`);
        }

        const cards = await response.json();
        if (Array.isArray(cards)) {
            // Filter out non-collectible or token cards if they don't have a release date and aren't collectible
            // But we might want them for lookups.
            return cards.map(normalizeCard);
        }
        
        throw new Error("Invalid response format from Untapped API");
    } catch (e) {
        console.error("Untapped fetch failed:", e.message);
        return []; 
    }
}

/**
 * Normalizes Untapped location data.
 */
function normalizeLocation(uLoc) {
    return {
        name: uLoc.name,
        description: cleanAbility(uLoc.description || ""),
        art: `https://snapjson.untapped.gg/art/loc/${uLoc.defId}.webp`,
        cardDefId: uLoc.defId,
        releaseDate: uLoc.seriesStartTimestamps && uLoc.seriesStartTimestamps[0] > 0 
            ? new Date(uLoc.seriesStartTimestamps[0]).toISOString() 
            : null
    };
}

export async function getAllLocationsUntapped(env) {
    if (!env || !env.MARVEL_SNAP_HUB) {
        return await fetchFreshUntappedLocations();
    }

    try {
        const cached = await env.MARVEL_SNAP_HUB.get(LOCATIONS_CACHE_KEY, { type: "json" });
        if (cached && Array.isArray(cached)) {
            return cached;
        }
    } catch (e) {
        console.error("Failed to read Untapped locations cache:", e);
    }

    const fresh = await fetchFreshUntappedLocations();
    
    if (fresh && fresh.length > 0) {
        try {
            await env.MARVEL_SNAP_HUB.put(LOCATIONS_CACHE_KEY, JSON.stringify(fresh), {
                expirationTtl: CACHE_TTL
            });
        } catch (e) {
            console.error("Failed to write Untapped locations cache:", e);
        }
    }

    return fresh;
}

async function fetchFreshUntappedLocations() {
    try {
        const response = await fetch(UNTAPPED_LOCATIONS_URL);
        if (!response.ok) throw new Error(`Untapped locations error: ${response.status}`);
        const locations = await response.json();
        if (Array.isArray(locations)) {
            return locations.map(normalizeLocation);
        }
        return [];
    } catch (e) {
        console.error("Untapped locations fetch failed:", e.message);
        return [];
    }
}
