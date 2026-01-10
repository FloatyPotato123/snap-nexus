
import { getAllCards, generateDeckcodeString, extractDeckcode, parseDeckcode } from "snapdeck";
import { sampleSize } from "lodash-es";

/**
 * Decodes a Marvel Snap deck code into a list of cards.
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

        if (format === 'text') {
            // Sort by Cost (Asc) -> Name (Asc)
            const sorted = deck.cards.sort((a, b) => {
                const costA = parseInt(a.cost) || 0;
                const costB = parseInt(b.cost) || 0;
                if (costA !== costB) return costA - costB;
                return a.name.localeCompare(b.name);
            });
            const names = sorted.map(c => `(${c.cost}) ${c.name}`).join(", ");
            return c.text(names);
        }

        return c.json({ cards: deck.cards });
    } catch (e) {
        if (format === 'text') return c.text(`Error: ${e.message}`);
        return c.json({ error: e.message }, 500);
    }
}

/**
 * Returns a 12-card random deck code.
 */
export async function handleRandomDeck() {
    const allCards = await getAllCards();
    const now = Date.now();
    const playable = allCards.filter(c => c.obtainable && new Date(c.releaseDate) <= now);
    const randomDeck = sampleSize(playable, 12);

    return new Response(generateDeckcodeString(randomDeck), {
        headers: { "Content-Type": "text/plain" },
    });
}

/**
 * Returns 3 random card names for a "Stress" challenge.
 */
export async function handleStressDeck() {
    const allCards = await getAllCards();
    const now = Date.now();
    const playable = allCards.filter(c => c.obtainable && new Date(c.releaseDate) <= now);
    const randomCards = sampleSize(playable, 3);

    // Format: "Card1, Card2, Card3"
    const responseText = randomCards.map(c => c.name).join(", ");

    return new Response(responseText, {
        headers: { "Content-Type": "text/plain" },
    });
}
