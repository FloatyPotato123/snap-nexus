
import { getAllCards, generateDeckcodeString } from "snapdeck";
import { sampleSize } from "lodash-es";

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
