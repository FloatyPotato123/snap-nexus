# Snap Nexus Twitch / Nightbot Commands

This document contains the setup strings to copy and paste into your Twitch chat to add these commands via Nightbot.

Replace `https://api.snapnexus.com` with your actual Cloudflare Worker domain if you are self-hosting.

---

### 1. `!sp` (Sparkline & SP Tracking)
Shows a player's recent SP trend graph and their rank/SP changes over the stream session.
**Command to add:**
```
!addcom !sp $(urlfetch https://api.snapnexus.com/api/player/sparkline?q=$(querystring)&window=$(twitch uptime))
```

### 2. Streamer-Specific SP Command (e.g., `!huskysp`)
Due to Nightbot's limitations with variable nesting, you cannot directly put `$(twitch uptime)` inside a `$(urlfetch)` for a specific hardcoded player. You must use an **alias command** so Nightbot calculates the uptime first. 

*   **Step 1:** Create a hidden backend command (e.g., `_huskysp`). When creating this command, the target player name/ID is hardcoded (like `q=Husky`), and it grabs the uptime from `$(query)`.
    ```
    !addcom _huskysp $(urlfetch https://api.snapnexus.com/api/player/sparkline?q=Husky&window=$(query))
    ```
*   **Step 2:** Create the actual command users will type (e.g., `!huskysp`), and set its alias to the hidden command. The body of this command just generates the uptime.
    ```
    !addcom !huskysp -a=_huskysp $(twitch uptime)
    ```
*(When a viewer types `!huskysp`, Nightbot calculates stream uptime, then passes it as the `$(query)` to `_huskysp`, which makes the API call. This effectively tracks SP only since the stream started).*

### 3. `!playtime`
Estimates how many minutes a player has been actively gaining/losing SP in the last 24 hours.
**Command to add:**
```
!addcom !playtime $(urlfetch https://api.snapnexus.com/api/player/playtime?q=$(querystring))
```

### 4. `!hot` (Locations)
Shows the currently active Hot/Featured location and the next upcoming one.
**Command to add:**
```
!addcom !hot $(urlfetch https://api.snapnexus.com/api/locations/hot)
```

### 5. `!newcards`
Outputs the Marvel Snap new card releases for the current and following week.
**Command to add:**
```
!addcom !newcards $(urlfetch https://api.snapnexus.com/api/cards/new-releases?format=text)
```

### 6. `!decode`
Takes a copied Marvel Snap deck code and outputs the list of 12 cards and their energy costs.
**Command to add:**
```
!addcom !decode $(urlfetch https://api.snapnexus.com/api/decks/decode?format=text&code=$(querystring))
```

### 7. `!randomdeck`
Generates a valid code for a completely random 12-card deck.
**Command to add:**
```
!addcom !randomdeck $(urlfetch https://api.snapnexus.com/api/decks/random)
```

### 8. `!stress`
Outputs 3 random cards for streamers doing challenge/stress runs.
**Command to add:**
```
!addcom !stress $(urlfetch https://api.snapnexus.com/api/decks/stress)
```
