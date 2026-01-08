
import { Hono } from "hono";
import { Buffer } from "buffer";
import clientUtilsScript from "../dist/client-utils.js.txt";
import logoBase64 from "./assets/logo.b64.txt";
globalThis.Buffer = Buffer;

import { handleRandomDeck, handleStressDeck } from "./handlers/deck.js";
import {
  handleLeaderboard,
  handlePlayerHistory,
  handleGetPlayerProfile,
  handleHistoryRange,
  handleLeaderboardComparison,
  handleLegacyHistory,
  handleAllianceProfile
} from "./handlers/leaderboard.js";
import { runDailyScrape } from "./handlers/scraper.js";

import indexHtml from "./templates/index.html";
import searchHtml from "./templates/player-search.html";
import profileHtml from "./templates/player-profile.html";
import decksHtml from "./templates/decks.html";
import allianceHtml from "./templates/alliance.html";
import navbarHtml from "./templates/components/navbar.html";

// Custom CSS
import customCss from "./styles/custom.css";
import { getWeeklyCardReleases } from "./handlers/cards";

const app = new Hono();

// Helper to inject Navbar
function render(html) {
  return html.replace('<!-- NAV -->', navbarHtml);
}

// --- ASSETS ---
app.get("/styles.css", (c) => c.text(customCss, 200, { 'Content-Type': 'text/css' }));
app.get("/client-utils.js", (c) => c.text(clientUtilsScript, 200, { 'Content-Type': 'application/javascript' }));

app.get("/favicon.ico", (c) => {
  const binary = Buffer.from(logoBase64, 'base64');
  return c.body(binary, 200, { 'Content-Type': 'image/png' });
});

app.get("/logo.png", (c) => {
  const binary = Buffer.from(logoBase64, 'base64');
  return c.body(binary, 200, { 'Content-Type': 'image/png' });
});

// --- UI ROUTES ---
app.get("/", (c) => c.html(render(indexHtml)));
app.get("/player-search", (c) => c.html(render(searchHtml)));
app.get("/player/:id", (c) => c.html(render(profileHtml)));
app.get("/decks", (c) => c.html(render(decksHtml)));
app.get("/alliance/:tag", (c) => c.html(render(allianceHtml)));

// --- API DATA ROUTES ---
const api = new Hono();
api.get("/decks/random", (c) => handleRandomDeck(c));
api.get("/decks/stress", (c) => handleStressDeck(c));

// Leaderboard/History
api.get("/players/search", (c) => handlePlayerHistory(c));
api.get("/player/:id", (c) => handleGetPlayerProfile(c));
api.get("/alliance/:tag", (c) => handleAllianceProfile(c));
api.get("/cards/new-releases", (c) => getWeeklyCardReleases(c));
api.get("/season/stats", (c) => handleHistoryRange(c));
api.get("/leaderboard/daily", (c) => handleLeaderboard(c));
api.get("/leaderboard/movers", (c) => handleLeaderboardComparison(c));
api.get("/history/legacy", (c) => handleLegacyHistory(c));

// Mount API under /api
app.route("/api", api);

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyScrape(env));
  },
};