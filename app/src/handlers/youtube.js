/**
 * KM Best YouTube Scraper & Handler
 * 
 * Fetches the latest "Best Decks" video description from KM Best's YouTube channel
 * and parses it on demand to extract deck lists and import codes for Twitch chat.
 */

import { KMBEST_CHANNEL_URL } from '../config.js';
import { errorResponse, notFoundResponse, badRequestResponse } from '../utils/response.js';

const UPLOADS_PLAYLIST_ID = 'UUxAk-60TmWvmnhGX1h6oFaQ';

/**
 * Fetches the latest "Best Decks" video ID from KM Best's channel uploads playlist.
 */
async function getLatestKMBestVideo(apiKey) {
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${UPLOADS_PLAYLIST_ID}&maxResults=10&key=${apiKey}`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`YouTube API Error: ${res.statusText}`);

    const data = await res.json();

    for (const item of data.items) {
        const lowerTitle = item.snippet.title.toLowerCase();
        if (lowerTitle.includes("best") && lowerTitle.includes("infinite") && lowerTitle.includes("decks")) {
            return item.snippet.resourceId.videoId;
        }
    }

    throw new Error("No 'Best Decks' video found recently");
}

/**
 * Fetches the video page and extracts the description via YouTube Data API.
 */
async function getKMBestDescription(videoId, apiKey) {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`YouTube API Error: ${res.statusText}`);

    const data = await res.json();
    if (!data.items || data.items.length === 0) {
        throw new Error("Video not found via API");
    }

    return data.items[0].snippet.description;
}

/**
 * Parses the raw YouTube description text into a structured list of decks.
 * Expects timestamp lines (e.g., "0:05 SuGi"), lines starting with "(Cost) Name", and Base64 codes.
 */
function parseKMDescription(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim());
    const decks = [];

    // 1. Extract titles from timestamps
    // Regex: look for lines like "X:YY Name" or "XX:YY Name" or "H:MM:SS Name"
    const titleRegex = /^(?:\d{1,2}:)?\d{1,2}:\d{2}\s+(.+)$/;
    const deckNames = [];

    for (const line of lines) {
        const match = line.match(titleRegex);
        if (match) {
            const name = match[1].trim();
            // Skip "Intro" or similar
            if (name.toLowerCase() !== 'intro') {
                deckNames.push(name);
            }
        }
    }

    // 2. Extract deck lists and base64 codes
    // Look for a block of >= 10 lines starting with "(Cost)" or "# (Cost)"
    let currentCards = [];
    let currentCode = null;

    // Regular expression to match "(Cost) Name" or "# (Cost) Name"
    const cardLineRegex = /^(?:#\s*)?\(\d\)\s+.+/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (cardLineRegex.test(line)) {
            currentCards.push(line);
        } else if (currentCards.length >= 10) { // Most decks have 12 cards, checking for at least 10
            // We have a block of cards. Now we need to find the base64 code.
            // It should be one of the next few non-empty lines, usually right after the cards.

            // Look ahead to find the code
            for (let j = i; j < lines.length && j < i + 5; j++) {
                const peekLine = lines[j];
                // Base64 regex (letters, numbers, +, /, =, usually 50+ chars for a deck code)
                if (peekLine.length > 30 && /^[A-Za-z0-9+/=]+$/.test(peekLine)) {
                    currentCode = peekLine;

                    decks.push({
                        cards: [...currentCards],
                        code: currentCode
                    });

                    // Reset for the next deck
                    currentCards = [];
                    currentCode = null;
                    i = j; // skip forward
                    break;
                }
            }

            // If we didn't find a code, reset anyway so we don't accumulate cards forever
            if (currentCards.length > 0) {
                currentCards = [];
            }
        } else if (line !== "") {
            // If we have some cards but hit an empty/non-card line, and we don't have enough cards, reset
            // Ignore blank lines between cards if occasionally present, but usually they are consecutive
            currentCards = [];
        }
    }

    // 3. Merge names with actual deck data
    // Assuming the order of timestamps matches the order of printed lists
    const finalDecks = [];
    const maxCount = Math.max(decks.length, deckNames.length);
    for (let i = 0; i < maxCount; i++) {
        finalDecks.push({
            id: i + 1,
            name: i < deckNames.length ? deckNames[i] : `Deck ${i + 1}`,
            cards: i < decks.length ? decks[i].cards : [],
            code: i < decks.length ? decks[i].code : null
        });
    }

    return finalDecks;
}

/**
 * Handle: !kmdecks
 * Output Example: 1. SuGi, 2. Shou, 3. Star-Lord
 */
export async function handleKMDecksList(c) {
    try {
        const apiKey = c.env.YOUTUBE_API_KEY;
        if (!apiKey) return c.text("Error: Missing YOUTUBE_API_KEY in worker environment.");

        const videoId = await getLatestKMBestVideo(apiKey);
        const desc = await getKMBestDescription(videoId, apiKey);
        const decks = parseKMDescription(desc);

        if (decks.length === 0) {
            return c.text("Error: Could not parse any decks from the latest video.");
        }

        const output = decks.map(d => `(${d.id}) ${d.name}`).join(' · ');
        return c.text(`${output} | Use !kmdeck <#> | Video: https://youtu.be/${videoId}`);
    } catch (e) {
        return c.text(`Error: ${e.message}`);
    }
}

/**
 * Handle: !kmdeck <n>
 * Output Example: (Cost) Card, (Cost) Card -> CODE: XXXXX
 */
export async function handleKMDeckDetails(c) {
    const numStr = c.req.param('n') || c.req.query('n') || c.req.query('num');
    const num = parseInt(numStr);

    if (isNaN(num) || num < 1) {
        return c.text("Error: Please provide a valid deck number (e.g., !kmdeck 1)");
    }

    try {
        const apiKey = c.env.YOUTUBE_API_KEY;
        if (!apiKey) return c.text("Error: Missing YOUTUBE_API_KEY in worker environment.");

        const videoId = await getLatestKMBestVideo(apiKey);
        const desc = await getKMBestDescription(videoId, apiKey);
        const decks = parseKMDescription(desc);

        if (decks.length === 0) {
            return c.text("Error: Could not parse any decks from the latest video.");
        }

        const max = decks.length;
        if (num > max) {
            return c.text(`Error: There are only ${max} decks in the latest video.`);
        }

        const deck = decks[num - 1]; // 1-indexed

        if (!deck.code || deck.cards.length === 0) {
            const count = decks.filter(d => d.code).length;
            return c.text(`Missing code! Only ${count} deck codes are in the description, so the deck numbers and titles may be mismatched.`);
        }

        const formattedCards = deck.cards.map(cardStr => {
            // Strip the "# " prefix so it looks like "(1) Nightcrawler"
            return cardStr.replace(/^#\s*/, '');
        });

        const cardsString = formattedCards.join(', ');
        return c.text(`${cardsString} -> ${deck.code}`);
    } catch (e) {
        return c.text(`Error: ${e.message}`);
    }
}
