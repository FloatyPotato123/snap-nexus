
import { Hono } from "hono";

import { Buffer } from "buffer";

globalThis.Buffer = Buffer;

import { handleRandomDeck, handleStressDeck, handleDecodeDeck } from "./handlers/deck.js";
import {
    handleLeaderboard,
    handleLeaderboardComparison,
    handleGetLiveLeaderboard,
    handleDebugSnapshot
} from "./handlers/leaderboard.js";
import {
    handlePlayerHistory,
    handleGetPlayerProfile
} from "./handlers/players.js";
import {
    handleHistoryRange,
    handleSeasonHistory
} from "./handlers/history.js";

import indexHtml from "./templates/index.html";
import searchHtml from "./templates/player-search.html";
import profileHtml from "./templates/player-profile.html";
import decksHtml from "./templates/decks.html";
import leaderboardHtml from "./templates/leaderboard.html";
import navbarHtml from "./templates/components/navbar.html";
import layoutHtml from "./templates/layout.html";

import { getWeeklyCardReleases } from "./handlers/cards.js";
import { runDailyScrape } from "./handlers/scraper.js";
import { runRollingScrape, handleGetRollingHistory, handleGetPlayerPlaytime, handleGetPlayerSparkline } from "./handlers/rolling.js";
import { CRON_SCHEDULES } from "./config.js";

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
api.get("/player/playtime", (c) => handleGetPlayerPlaytime(c));
api.get("/player/sparkline", (c) => handleGetPlayerSparkline(c));
api.get("/player/:id/sparkline", (c) => handleGetPlayerSparkline(c));
api.get("/players/search", (c) => handlePlayerHistory(c));
api.get("/player/:id", (c) => handleGetPlayerProfile(c));
api.get("/cards/new-releases", (c) => getWeeklyCardReleases(c));
api.get("/season/stats", (c) => handleHistoryRange(c));
api.get("/leaderboard/daily", (c) => handleLeaderboard(c));
api.get("/leaderboard/live", (c) => handleGetLiveLeaderboard(c));
api.get("/leaderboard/movers", (c) => handleLeaderboardComparison(c));
api.get("/history/seasons", (c) => handleSeasonHistory(c));
api.get("/leaderboard/rolling", (c) => handleGetRollingHistory(c));
api.get("/debug/snapshot", (c) => handleDebugSnapshot(c));

// Mount API under /api
app.route("/api", api);

export default {
    fetch: app.fetch,
    async scheduled(event, env, ctx) {
        if (event.cron === CRON_SCHEDULES.ROLLING_UPDATE) {
            ctx.waitUntil(runRollingScrape(env));
        } else if (event.cron === CRON_SCHEDULES.DAILY_SNAPSHOT || !event.cron) {
            ctx.waitUntil(runDailyScrape(env));
        }
    },
};
