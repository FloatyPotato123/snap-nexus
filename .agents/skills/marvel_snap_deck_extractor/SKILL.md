---
name: marvel_snap_deck_extractor
description: Extracts card names from an image and generates a Marvel Snap deck code.
---

# Marvel Snap Deck Extractor Skill

Use this skill when the user provides an image of a Marvel Snap deck and asks for the deck code.

## Instructions

1. **Analyze the Image**: Use your vision capabilities to identify the 12 cards in the deck. Note the deck name if visible.
2. **List the Cards**: Create a comma-separated list of the card names.
3. **Run the Extraction Script**: Execute the helper script with the list of cards.

```bash
node .agents/skills/marvel_snap_deck_extractor/scripts/extract_deck.js "Card 1, Card 2, Card 3, ..." "Deck Name"
```

4. **Provide the Result**: Return the generated deck code to the user along with the list of cards for verification.

## Resources
- **Script**: `.agents/skills/marvel_snap_deck_extractor/scripts/extract_deck.js`
- **Known Card IDs**: The script fetches the latest `cardDefId` mappings from the `snapdeck` repository.
