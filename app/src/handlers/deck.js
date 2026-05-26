import { generateDeckcodeString, extractDeckcode, parseDeckcode } from "snapdeck";
import { getAllCardsUntapped as getAllCardsLive } from "./untapped_api.js";
import { sampleSize } from "lodash-es";

/**
 * Decodes a Marvel Snap deck code into a list of cards.
 * 
 * Twitch Command: !decode [code]
 * Output Example: (1) Bast, (1) Squirrel Girl, (1) The Hood, (2) Havok, (2) Mysterio, (3) Beast, (3) Bishop, (3) Hit-Monkey, (3) Sage, (3) Shadow King, (5) Iron Man, (5) Valkyrie
 */
export async function handleDecodeDeck(c) {
    const code = c.req.query("code");
    const format = c.req.query("format"); // 'json' or 'text'

    if (!code) {
        if (format === 'text') return c.text("Error: Missing 'code' parameter.");
        return c.json({ error: "Missing 'code' query parameter" }, 400);
    }

    try {
        const deckcode = extractDeckcode(code);
        if (!deckcode) {
            if (format === 'text') return c.text("Error: Invalid deck code format.");
            return c.json({ error: "Invalid deck code format" }, 400);
        }

        const deck = await parseDeckcode(deckcode);
        if (!deck) {
            if (format === 'text') return c.text("Error: Failed to parse deck code.");
            return c.json({ error: "Failed to parse deck" }, 500);
        }

        // Hydrate with live data to ensure accurate stats/names
        const allCards = await getAllCardsLive(c.env);
        const hydratedCards = deck.cards.map(snapdeckCard => {
            const liveCard = allCards.find(lc => lc.cardDefId === snapdeckCard.cardDefId);
            return liveCard || snapdeckCard;
        });

        if (format === 'text') {
            // Sort by Cost (Asc) -> Name (Asc)
            const sorted = hydratedCards.sort((a, b) => {
                const costA = parseInt(a.cost) || 0;
                const costB = parseInt(b.cost) || 0;
                if (costA !== costB) return costA - costB;
                return a.name.localeCompare(b.name);
            });
            const names = sorted.map(c => `(${c.cost}) ${c.name}`).join(", ");
            return c.text(names);
        }

        return c.json({ cards: hydratedCards });
    } catch (e) {
        if (format === 'text') return c.text(`Error: ${e.message}`);
        return c.json({ error: e.message }, 500);
    }
}

/**
 * Returns a 12-card random deck code.
 * 
 * Twitch Command: !deckcode
 * Output Example: UHRydDcsVGhuNSxTcjQsTWRzNixDbGxuV25nQixHcmduNixRazUsU3R0cjcsU2x2clNyZnJGcnN0U3RwczE2LEtkT21nOCxJcm5QdHJ0QixNcnBoNQ==
 */
export async function handleRandomDeck(c) {
    // Fetch live data directly from Untapped API
    const allCards = await getAllCardsLive(c.env);
    const now = Date.now();
    
    // Filter playable cards
    const playable = allCards.filter(c => c.obtainable && c.releaseDate && new Date(c.releaseDate) <= now);

    const randomDeck = sampleSize(playable, 12);

    return new Response(generateDeckcodeString(randomDeck), {
        headers: { "Content-Type": "text/plain" },
    });
}

/**
 * Returns n random card names with cost.
 * 
 * Twitch Command: !draft [n]
 * Output Example: (1) Bast, (2) Mysterio, (3) Sage
 */
export async function handleRandomCards(c) {
    const nStr = c.req.query("n") || c.req.query("count");
    const n = parseInt(nStr) || 1;
    const allCards = await getAllCardsLive(c.env);
    const now = Date.now();
    const playable = allCards.filter(c => c.obtainable && new Date(c.releaseDate) <= now);
    const randomCards = sampleSize(playable, Math.min(n, playable.length));

    // Format: "Card1, Card2, Card3"
    const responseText = randomCards.map(c => c.name).join(", ");

    return c.text(responseText);
}
