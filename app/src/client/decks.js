/**
 * client/decks.js
 * Logic for the Deck Generator page.
 */
(function () {
    window.fetchDeck = async function (type) {
        // Updated to use /api prefix
        const endpoint = type === 'random' ? '/api/decks/random' : '/api/decks/stress';
        const el = document.getElementById('deckResult');
        el.innerText = "Generating...";
        el.style.color = "#aaa";

        try {
            const req = await fetch(endpoint);
            const text = await req.text();
            el.innerText = text;
            el.style.color = "var(--accent-purple)";
        } catch (e) {
            el.innerText = "Error fetching deck.";
            el.style.color = "#f44336";
            console.error(e);
        }
    }

    window.copyDeck = function () {
        const el = document.getElementById('deckResult');
        const btn = document.getElementById('copyBtn');
        const text = el.innerText;

        if (!text || text.includes("Click a button") || text.includes("Generating") || text.includes("Error")) {
            return;
        }

        navigator.clipboard.writeText(text).then(() => {
            const originalText = btn.innerHTML;
            btn.innerHTML = "✅ Copied!";
            setTimeout(() => btn.innerHTML = originalText, 2000);
        }).catch(err => {
            btn.innerText = "❌ Error";
            console.error("Clipboard write failed:", err);
        });
    }
})();
