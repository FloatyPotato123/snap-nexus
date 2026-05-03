
/**
 * Utility to fetch and cache live card data from Marvel Snap Zone.
 * Uses Cloudflare KV (MARVEL_SNAP_HUB) for caching.
 */

const MSZ_API_URL = "https://marvelsnapzone.com/getinfo/?searchtype=cards&searchcardstype=true";
const CARDS_CACHE_KEY = "live_cards_data_v3";
const CACHE_TTL = 3600 * 6; // 6 hours

/**
 * Normalizes MSZ card data to the format expected by the app.
 */
function normalizeCard(mszCard) {
    return {
        cid: mszCard.cid,
        name: mszCard.name,
        type: mszCard.type,
        cost: parseInt(mszCard.cost) || 0,
        power: parseInt(mszCard.power) || 0,
        description: cleanAbility(mszCard.ability || ""),
        flavor: mszCard.flavor || "",
        art: mszCard.art || "",
        url: mszCard.url || "",
        status: mszCard.status || "unreleased",
        // Normalize cardDefId to match snapdeck IDs (often just alphanumeric)
        cardDefId: mszCard.carddefid || mszCard.name.replace(/[^a-zA-Z0-9]/g, ""),
        obtainable: mszCard.status === "released",
        releaseDate: (mszCard.variants && mszCard.variants[0] && mszCard.variants[0].ReleaseDate && mszCard.variants[0].ReleaseDate < 2000000000)
            ? new Date(mszCard.variants[0].ReleaseDate * 1000).toISOString() 
            : null,
        source: mszCard.source || "Unknown"
    };
}

function cleanAbility(text) {
    if (!text) return "";
    return text
        .replace(/<[^>]*>/g, "") // Remove HTML tags
        .replace(/!none/g, "")   // Remove placeholders
        .trim();
}

/**
 * Fetches all cards, using KV cache if available.
 * @param {object} env - Cloudflare environment (contains KV binding)
 */
export async function getAllCardsLive(env) {
    if (!env || !env.MARVEL_SNAP_HUB) {
        console.warn("KV namespace MARVEL_SNAP_HUB not found. Fetching live without cache.");
        return await fetchFreshCards();
    }

    try {
        const cached = await env.MARVEL_SNAP_HUB.get(CARDS_CACHE_KEY, { type: "json" });
        if (cached && Array.isArray(cached)) {
            console.log("Using cached live cards data.");
            return cached;
        }
    } catch (e) {
        console.error("Failed to read from KV cache:", e);
    }

    const fresh = await fetchFreshCards();
    
    if (fresh && fresh.length > 0) {
        try {
            await env.MARVEL_SNAP_HUB.put(CARDS_CACHE_KEY, JSON.stringify(fresh), {
                expirationTtl: CACHE_TTL
            });
        } catch (e) {
            console.error("Failed to write to KV cache:", e);
        }
    }

    return fresh;
}

async function fetchFreshCards() {
    console.log("Fetching fresh cards from Marvel Snap Zone...");
    try {
        const response = await fetch(MSZ_API_URL, {
            headers: {
                "User-Agent": "SnapNexusBot/1.0"
            }
        });
        
        if (!response.ok) {
            throw new Error(`MSZ API error: ${response.status}`);
        }

        const data = await response.json();
        if (data && data.success && Array.isArray(data.success.cards)) {
            return data.success.cards.map(normalizeCard);
        }
        
        throw new Error("Invalid response format from MSZ API");
    } catch (e) {
        console.error("Live fetch failed:", e.message);
        return []; 
    }
}

/**
 * Helper to get a single card by ID or Name from the live set.
 */
export async function getCardByIdentifierLive(env, identifier) {
    const allCards = await getAllCardsLive(env);
    const normalizedId = identifier.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    return allCards.find(c => 
        c.cardDefId.toLowerCase() === normalizedId || 
        c.name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedId
    ) || null;
}
