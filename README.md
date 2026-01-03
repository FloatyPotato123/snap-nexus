# Marvel Snap Hub (Cloudflare Worker)

A comprehensive backend and frontend for Marvel Snap stats, powered by Cloudflare Workers, Hono, and KV.

## Features

### 📊 Leaderboard & Profile Tracking
- **Live Leaderboard**: Tracks Top 1000 Infinite players.
- **Player Search**: Text-based search (`!whois`) with alias tracking.
- **Vote & Movers**: Tracks daily rank changes and SP gains.
- **Alliance Profiles**: Aggregated stats for Alliance tags (`/alliance/:tag`).

### 🃏 Game Data
- **Card Releases**: Tracks weekly card releases (`/api/cards/new-releases`).
- **Deck Generator**: Random deck builder for challenges (`/api/decks/random`).
- **Stress Decks**: Generates specific challenge decks (`/api/decks/stress`).

### 🛠 Tech Stack
- **Framework**: [Hono](https://hono.dev) (Lightweight Edge standards)
- **Platform**: Cloudflare Workers
- **Database**: Cloudflare KV (Key-Value Storage)
- **Build Tool**: esbuild
- **Styling**: Pico.css

## UI Routes

| Path | Description |
|------|-------------|
| `/` | Main Dashboard (Leaderboard, Charts) |
| `/player-search` | Player Lookup Page |
| `/player/:id` | Player Profile Page |
| `/decks` | Deck Builder Page |
| `/alliance/:tag` | Alliance Stats Page |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/leaderboard/daily` | Current Top 1000 Leaderboard |
| `/api/leaderboard/movers` | Daily Rank Changes (Movers & Shakers) |
| `/api/players/search?q={name}` | Search player history |
| `/api/player/:id` | Get specific player stats |
| `/api/season/stats` | Season-wide historical stats |
| `/api/cards/new-releases` | Weekly card release schedule |
| `/api/decks/random` | Generate a random deck |
| `/api/decks/stress` | Generate a stress-test deck |
| `/api/history/legacy` | Legacy data archival access |

## Automation

- **Daily Scraper**: Runs at 19:00 UTC via Cloudflare Cron Triggers to archive leaderboard positions.

## Setup & Development

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Run Locally**
   ```bash
   npx wrangler dev
   ```

3. **Deploy**
   ```bash
   npm run build
   npx wrangler deploy
   ```
