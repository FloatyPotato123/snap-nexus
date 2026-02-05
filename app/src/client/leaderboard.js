/**
 * client/leaderboard.js
 * Logic for the Infinite Leaderboard page (leaderboard.html).
 */
(function () {
    const $ = SnapUtils.$;
    const { CONSTANTS } = window.SnapUtils;

    // Wait for DOM and Dependencies
    window.addEventListener('DOMContentLoaded', async () => {
        if (typeof SnapUtils === 'undefined') {
            console.error("Missing dependency: SnapUtils");
            return;
        }

        const $ = SnapUtils.$;
        const { CONSTANTS, getSeasonEnd, getCurrentSeason } = window.SnapUtils;

        const body = $('leaderboardBody');
        const loader = $('loader');
        const seasonTrigger = $('seasonTrigger');
        const seasonTriggerText = $('seasonTriggerText');
        const seasonDropdown = $('seasonDropdown');

        if (!body || !loader || !seasonTrigger || !seasonDropdown) return;

        /**
         * Populates the season dropdown with radio button items.
         */
        function populateSeasons() {
            seasonDropdown.innerHTML = '';
            const now = new Date();
            const current = getCurrentSeason(now);
            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

            const addItem = (val, text, isDefault) => {
                const div = document.createElement('div');
                div.className = 'season-dropdown-item';
                div.innerHTML = `
                    <label>
                        <input type="radio" name="season-group" value="${val}" class="season-check" ${isDefault ? 'checked' : ''} onchange="SnapLeaderboard.handleSeasonChange()">
                        <span>${text}</span>
                    </label>
                `;
                seasonDropdown.appendChild(div);
            };

            // Live Option
            addItem('live', 'Current Season', true);

            // Generate list from current back to DATA_START
            let year = current.year;
            let month = current.month - 1; // 0-indexed for calculation

            while (year > CONSTANTS.DATA_START_YEAR || (year === CONSTANTS.DATA_START_YEAR && month >= CONSTANTS.DATA_START_MONTH)) {
                // Skip the actually "current" season from the historical list as it has its own "Live" option
                if (!(year === current.year && month === current.month - 1)) {
                    const d = new Date(Date.UTC(year, month, 15));
                    const endDate = getSeasonEnd(d);
                    const label = `${months[month]} ${year}`;

                    const yyyy = endDate.getUTCFullYear();
                    const mm = String(endDate.getUTCMonth() + 1).padStart(2, '0');
                    const dd = String(endDate.getUTCDate()).padStart(2, '0');
                    const val = `${yyyy}-${mm}-${dd}`;

                    addItem(val, label, false);
                }

                month--;
                if (month < 0) {
                    month = 11;
                    year--;
                }
            }
        }

        /**
         * Renders a single leaderboard row HTML string.
         */
        function renderLeaderboardRow(p, index, isHistorical) {
            let indicatorHtml = '';

            // Fallback rank if missing, 0-indexed, or historical
            const displayRank = (isHistorical || p.rank === 0 || p.rank === undefined || p.rank === null) ? (index + 1) : p.rank;

            if (!isHistorical) {
                if (p.isNew) {
                    indicatorHtml = `<span style="font-size:0.9rem; margin-left:10px;" title="New entry today">✨</span>`;
                } else if (p.delta !== 0 && p.delta !== undefined && p.delta !== null) {
                    const deltaClass = p.delta > 0 ? 'delta-up' : 'delta-down';
                    const deltaSymbol = p.delta > 0 ? '▲' : '▼';
                    indicatorHtml = `<span class="${deltaClass}" style="margin-left:10px;">${deltaSymbol}&nbsp;${Math.abs(p.delta)}</span>`;
                }
            }

            return `
                <tr class="leaderboard-row" onclick="SnapUtils.navigateTo(event, '/player/${p.id || p.playerId}?ref=leaderboard')">
                    <td class="rank-col">
                        <div style="display:flex; align-items:center;">
                            <span class="rank-value">#${displayRank}</span>
                            ${indicatorHtml}
                        </div>
                    </td>
                    <td class="name-col">
                        <a href="/player/${p.id || p.playerId}?ref=leaderboard" class="player-link" onclick="event.stopPropagation()">${p.playerName || p.name}</a>
                    </td>
                    <td class="score-col">
                        ${(p.score || 0).toLocaleString()}
                    </td>
                </tr>
            `;
        }

        async function fetchLeaderboard(view = 'live') {
            body.innerHTML = '';
            loader.style.display = 'block';
            loader.innerHTML = '<span aria-busy="true">Loading leaderboard...</span>';

            try {
                let url = CONSTANTS.API.LEADERBOARD_LIVE;
                let isHistorical = false;

                if (view !== 'live') {
                    const [y, m, d] = view.split('-');
                    url = `/api/leaderboard/daily?year=${y}&month=${m}&day=${d}`;
                    isHistorical = true;
                }

                const res = await fetch(url);
                if (!res.ok) throw new Error('API Error');
                const data = await res.json();

                const results = Array.isArray(data) ? data : (data.results || []);
                loader.style.display = 'none';

                if (results.length === 0) {
                    loader.style.display = 'block';
                    loader.innerHTML = '<span class="status-msg">No data available for this period.</span>';
                    return;
                }

                body.innerHTML = results.map((p, index) => renderLeaderboardRow(p, index, isHistorical)).join('');

            } catch (err) {
                if (loader) loader.innerHTML = '<span class="error-msg">Failed to load leaderboard. Please try again later.</span>';
                console.error(err);
            }
        }

        // --- Event Handlers ---

        function toggleSeasonDropdown() {
            const isOpen = seasonDropdown.style.display === 'block';
            seasonDropdown.style.display = isOpen ? 'none' : 'block';
        }

        function handleSeasonSelection(e) {
            if (e.target.matches('.season-check')) {
                const checked = e.target;
                const label = checked.parentElement.querySelector('span').innerText;
                seasonTriggerText.innerText = label;
                seasonDropdown.style.display = 'none';
                fetchLeaderboard(checked.value);
            }
        }

        // Initialize Events
        seasonTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSeasonDropdown();
        });

        seasonDropdown.addEventListener('change', handleSeasonSelection);

        // Global click handler to close dropdown
        document.addEventListener('click', (e) => {
            if (seasonDropdown.style.display === 'block') {
                if (!seasonDropdown.contains(e.target) && !seasonTrigger.contains(e.target)) {
                    seasonDropdown.style.display = 'none';
                }
            }
        });

        // Initialize
        populateSeasons();
        fetchLeaderboard();
    });
})();
