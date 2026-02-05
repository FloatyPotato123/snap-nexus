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

        async function fetchLeaderboard() {
            const body = $('leaderboardBody');
            const loader = $('loader');

            if (!body || !loader) return;

            try {
                const res = await fetch(CONSTANTS.API.LEADERBOARD_LIVE);
                if (!res.ok) throw new Error('API Error');
                const { results } = await res.json();

                loader.style.display = 'none';

                body.innerHTML = results.map(p => {

                    let indicatorHtml = '';
                    if (p.isNew) {
                        indicatorHtml = `<span style="font-size:0.9rem; margin-left:10px;" title="New entry today">✨</span>`;
                    } else if (p.delta !== 0) {
                        const deltaClass = p.delta > 0 ? 'delta-up' : 'delta-down';
                        const deltaSymbol = p.delta > 0 ? '▲' : '▼';
                        indicatorHtml = `<span class="${deltaClass}" style="margin-left:10px;">${deltaSymbol}&nbsp;${Math.abs(p.delta)}</span>`;
                    }

                    return `
                        <tr class="leaderboard-row" onclick="SnapUtils.navigateTo(event, '/player/${p.id}?ref=leaderboard')">
                            <td class="rank-col">
                                <div style="display:flex; align-items:center;">
                                    <span class="rank-value">#${p.rank}</span>
                                    ${indicatorHtml}
                                </div>
                            </td>
                            <td class="name-col">
                                <a href="/player/${p.id}?ref=leaderboard" class="player-link" onclick="event.stopPropagation()">${p.name}</a>
                            </td>
                            <td class="score-col">
                                ${p.score.toLocaleString()}
                            </td>
                        </tr>
                    `;
                }).join('');

            } catch (err) {
                if (loader) loader.innerHTML = '<span class="error-msg">Failed to load leaderboard. Please try again later.</span>';
                console.error(err);
            }
        }



        // Initialize
        fetchLeaderboard();
    });
})();
