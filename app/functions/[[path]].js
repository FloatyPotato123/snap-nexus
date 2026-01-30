
import { Hono } from "hono";

import { Buffer } from "buffer";

globalThis.Buffer = Buffer;

import { handleRandomDeck, handleStressDeck, handleDecodeDeck } from "../src/handlers/deck.js";
import {
    handleLeaderboard,
    handleLeaderboardComparison,
    handleGetLiveLeaderboard,
    handleDebugSnapshot
} from "../src/handlers/leaderboard.js";
import {
    handlePlayerHistory,
    handleGetPlayerProfile
} from "../src/handlers/players.js";
import {
    handleHistoryRange,
    handleSeasonHistory
} from "../src/handlers/history.js";

import indexHtml from "../src/templates/index.html";
import searchHtml from "../src/templates/player-search.html";
import profileHtml from "../src/templates/player-profile.html";
import decksHtml from "../src/templates/decks.html";
import leaderboardHtml from "../src/templates/leaderboard.html";
import navbarHtml from "../src/templates/components/navbar.html";
import layoutHtml from "../src/templates/layout.html";

import { getWeeklyCardReleases } from "../src/handlers/cards.js";

const app = new Hono();

// Helper to render with Layout
function render(content, title = 'Snap Nexus', headScripts = '', footerScripts = '') {
    return layoutHtml
        .replace('<!-- TITLE -->', title)
        .replace('<!-- NAV -->', navbarHtml)
        .replace('<!-- CONTENT -->', content)
        .replace('<!-- HEAD_SCRIPTS -->', headScripts)
        .replace('<!-- FOOTER_SCRIPTS -->', footerScripts);
}

// --- UI ROUTES ---
app.get("/", (c) => c.html(render(indexHtml, 'Infinite Dashboard - Snap Nexus', '', '<script src="/client/home.js"></script>')));
app.get("/player-search", (c) => c.html(render(searchHtml, 'Player Search - Snap Nexus', '', '<script src="/client/search.js"></script>')));
app.get("/player/:id", (c) => c.html(render(profileHtml, 'Player Profile - Snap Nexus', '<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns/dist/chartjs-adapter-date-fns.bundle.min.js"></script>', '<script src="/client/profile.js"></script>')));
app.get("/decks", (c) => c.html(render(decksHtml, 'Deck Generator - Snap Nexus', '', '<script src="/client/decks.js"></script>')));
app.get("/leaderboard", (c) => c.html(render(leaderboardHtml, 'Infinite Leaderboard - Snap Nexus', '', '<script src="/client/leaderboard.js"></script>')));

// --- API DATA ROUTES ---
const api = new Hono();
api.get("/decks/random", (c) => handleRandomDeck(c));
api.get("/decks/stress", (c) => handleStressDeck(c));
api.get("/decks/decode", (c) => handleDecodeDeck(c));

// Leaderboard/History
api.get("/players/search", (c) => handlePlayerHistory(c));
api.get("/player/:id", (c) => handleGetPlayerProfile(c));
api.get("/cards/new-releases", (c) => getWeeklyCardReleases(c));
api.get("/season/stats", (c) => handleHistoryRange(c));
api.get("/leaderboard/daily", (c) => handleLeaderboard(c));
api.get("/leaderboard/live", (c) => handleGetLiveLeaderboard(c));
api.get("/leaderboard/movers", (c) => handleLeaderboardComparison(c));
api.get("/history/seasons", (c) => handleSeasonHistory(c));
api.get("/debug/snapshot", (c) => handleDebugSnapshot(c));

// Mount API under /api
// Mount API under /api
app.route("/api", api);

export default {
    async fetch(request, env, ctx) {


        // 1. Try to handle the request with the Hono App
        const response = await app.fetch(request, env, ctx);

        // 2. If Hono returns 404, fallback to Pages Static Assets
        if (response.status === 404) {
            if (env.ASSETS) {
                return env.ASSETS.fetch(request);
            }
            // In local 'wrangler dev' mode, we just let the request through
            // provided it's handled by the --site proxy.
            return new Response("Not Found", { status: 404 });
        }

        // 3. Otherwise return the Hono response
        return response;
    }
};
