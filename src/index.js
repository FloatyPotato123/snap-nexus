
import { Hono } from "hono";
import { Buffer } from "buffer";
import clientUtilsScript from "../dist/client-utils.js.txt";
import clientProfileScript from "../dist/client-profile.js.txt";
import clientHomeScript from "../dist/client-home.js.txt";
import clientDecksScript from "../dist/client-decks.js.txt";
import clientSearchScript from "../dist/client-search.js.txt";
import clientLeaderboardScript from "../dist/client-leaderboard.js.txt";
import clientNavbarScript from "../dist/client-navbar.js.txt";
import logoBase64 from "./assets/logo.b64.txt";
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
  handleLegacyHistory
} from "./handlers/history.js";
import { runDailyScrape } from "./handlers/scraper.js";

import indexHtml from "./templates/index.html";
import searchHtml from "./templates/player-search.html";
import profileHtml from "./templates/player-profile.html";
import decksHtml from "./templates/decks.html";
import leaderboardHtml from "./templates/leaderboard.html";
import navbarHtml from "./templates/components/navbar.html";
import layoutHtml from "./templates/layout.html";

// Custom CSS
import customCss from "./styles/custom.css";
import { getWeeklyCardReleases } from "./handlers/cards";

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

// --- ASSETS ---
app.get("/styles.css", (c) => c.text(customCss, 200, { 'Content-Type': 'text/css' }));
app.get("/client-utils.js", (c) => c.text(clientUtilsScript, 200, { 'Content-Type': 'application/javascript' }));
app.get("/client/profile.js", (c) => c.text(clientProfileScript, 200, { 'Content-Type': 'application/javascript' }));
app.get("/client/home.js", (c) => c.text(clientHomeScript, 200, { 'Content-Type': 'application/javascript' }));
app.get("/client/decks.js", (c) => c.text(clientDecksScript, 200, { 'Content-Type': 'application/javascript' }));
app.get("/client/search.js", (c) => c.text(clientSearchScript, 200, { 'Content-Type': 'application/javascript' }));
app.get("/client/leaderboard.js", (c) => c.text(clientLeaderboardScript, 200, { 'Content-Type': 'application/javascript' }));
app.get("/client/navbar.js", (c) => c.text(clientNavbarScript, 200, { 'Content-Type': 'application/javascript' }));

app.get("/favicon.ico", (c) => {
  const binary = Buffer.from(logoBase64, 'base64');
  return c.body(binary, 200, { 'Content-Type': 'image/png' });
});

app.get("/logo.png", (c) => {
  const binary = Buffer.from(logoBase64, 'base64');
  return c.body(binary, 200, { 'Content-Type': 'image/png' });
});

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
api.get("/history/legacy", (c) => handleLegacyHistory(c));
api.get("/debug/snapshot", (c) => handleDebugSnapshot(c));

// Mount API under /api
app.route("/api", api);

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyScrape(env));
  },
};