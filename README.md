# Snap Nexus (Cloudflare Pages)

A comprehensive backend and frontend for Marvel Snap stats, powered by Cloudflare Pages (Advanced Mode), Hono, and D1.

## 🏗 Architecture

The project is split into two main components:
- **App (`/app`)**: A Cloudflare Pages application serving the web UI and API via a single `_worker.js` (Advanced Mode).
- **Scraper (`/scraper`)**: A Cloudflare Worker that handles background data collection and updates the D1 database.

## 🚀 Features

### 📊 Leaderboard & Profile Tracking
- **Live Leaderboard**: Tracks Top 1000 Infinite players.
- **Player Search**: Text-based search with alias tracking and rank sorting.
- **Gainers & Pumpers**: Tracks daily rank changes and SP gains.

### 🃏 Game Data
- **Card Releases**: Tracks weekly card releases.
- **Deck Generator**: Random deck builder for challenges.

### 🛠 Tech Stack
- **Framework**: [Hono](https://hono.dev)
- **Platform**: Cloudflare Pages + Cloudflare Workers
- **Database**: 
    - **Cloudflare D1**: Main SQL database for search indexing and history tracking.
    - **Cloudflare KV**: Snapshot and metadata storage.
- **Build Tool**: esbuild

## 📂 Project Structure

- `app/src/`: Core logic, handlers, and templates.
- `app/public/`: Static assets and build output for the Pages app.
- `app/functions/`: Entry point for Pages Advanced Mode.
- `scraper/`: Background worker for data collection.

## 🛠 Setup & Development

1. **Install Dependencies**
   ```bash
   npm install
   ```

## 💻 Local Development Workflow

The development environment is fully automated. You only need one command:

1. **Run Dev Server**:
   ```bash
   npm run dev
   ```
   This command automatically:
   - Performs an initial build of all assets.
   - **Watches** for changes in both frontend (`app/src/client/`) and backend (`app/src/handlers/`, templates, etc.).
   - Connects to your live Cloudflare D1/KV data automatically (configured in `wrangler.toml`).

2. **Save and Refresh**:
   Just edit any file in `app/src/` and hit save. The watcher will re-bundle the change in the background. Simply refresh your browser to see the result.

3. **Build**
   ```bash
   npm run build
   ```

4. **Deploy**
   Deployment is handled automatically via GitHub Actions on push to `main`.
