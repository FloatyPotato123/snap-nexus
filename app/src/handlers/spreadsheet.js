
export async function getRandomUncheckedCards(c) {
    try {
        const spreadsheetId = '19oBoNHfuVqFT6D9Yy4sjujcE6EjBgW-wT9DmcFdiPf8';
        const gid = '1240312356'; // "Not yet completed" sheet
        const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch spreadsheet: ${response.statusText}`);
        }

        const csvData = await response.text();
        const cards = csvData
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0);

        if (cards.length < 2) {
            return c.text("No unchecked cards found!");
        }

        // Pick two unique random cards
        const shuffled = cards.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, 2);

        return c.text(`${selected[0]}, ${selected[1]}`);
    } catch (error) {
        return c.text(`Error: ${error.message}`, 500);
    }
}
