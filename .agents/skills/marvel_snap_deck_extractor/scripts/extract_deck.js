import fs from 'fs';
import path from 'path';

const CARDS_URL = 'https://raw.githubusercontent.com/Mottelz/snapdeck/main/src/models/cards.json';
const CACHE_FILE = path.join(process.cwd(), '.agents/skills/marvel_snap_deck_extractor/cards_cache.json');

async function getCards() {
    if (fs.existsSync(CACHE_FILE)) {
        const stats = fs.statSync(CACHE_FILE);
        const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
        if (ageInHours < 24) {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }
    }

    console.error('Fetching latest cards data...');
    const response = await fetch(CARDS_URL);
    const data = await response.json();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
    return data;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('Usage: node extract_deck.js "Card 1, Card 2, ..." ["Deck Name"]');
        process.exit(1);
    }

    const cardsInput = args[0].split(',').map(s => s.trim());
    const deckName = args[1] || 'New Deck';

    const allCards = await getCards();
    const deckCards = [];
    const missing = [];

    for (const name of cardsInput) {
        const found = allCards.find(c => c.name.toLowerCase() === name.toLowerCase() && c.obtainable);
        if (found) {
            deckCards.push({ CardDefId: found.cardDefId });
        } else {
            missing.push(name);
        }
    }

    if (missing.length > 0) {
        console.error('Missing cards:', missing.join(', '));
    }

    if (deckCards.length === 0) {
        console.error('No valid cards found.');
        process.exit(1);
    }

    const deck = {
        Name: deckName,
        Cards: deckCards
    };

    const code = Buffer.from(JSON.stringify(deck)).toString('base64');
    console.log('--- DECK CODE ---');
    console.log(code);
    console.log('-----------------');
    console.log(`Cards: ${deckCards.length}/12`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
