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

                const { escapeHtml } = window.SnapUtils;
                body.innerHTML = results.map(p => {
                    const tier = p.rank <= 10 ? 'top-10' : (p.rank <= 100 ? 'top-100' : 'normal');

                    // Delta Logic
                    let tickerHtml = '';
                    if (p.isNew) {
                        tickerHtml = `<span title="New Entry today" style="font-size:0.9rem; margin-left:4px; cursor:help;">✨</span>`;
                    } else if (p.delta > 0) {
                        tickerHtml = `<span style="color:#4caf50; font-size:0.75rem; margin-left:4px;">▲ ${p.delta}</span>`;
                    } else if (p.delta < 0) {
                        tickerHtml = `<span style="color:#f44336; font-size:0.75rem; margin-left:4px;">▼ ${Math.abs(p.delta)}</span>`;
                    } else {
                        tickerHtml = `<span style="color:var(--pico-muted-color); font-size:0.75rem; margin-left:4px;">-</span>`;
                    }

                    return `
                        <tr class="card-clickable" data-tier="${tier}" onclick="SnapUtils.navigateTo(event, '/player/${escapeHtml(p.id)}?ref=leaderboard')">
                            <td>
                                <div style="display:flex; align-items:center; gap:4px;">
                                    <span class="rank-badge">#${p.rank}</span>
                                    ${tickerHtml}
                                </div>
                            </td>
                            <td>
                                <a href="/player/${escapeHtml(p.id)}?ref=leaderboard" style="text-decoration:none; color:inherit;" onclick="event.stopPropagation()"><strong>${escapeHtml(p.name)}</strong></a>
                            </td>
                            <td style="text-align: right; font-variant-numeric: tabular-nums;">
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

        // Back to Top Logic
        const backToTopBtn = $('backToTop');
        if (backToTopBtn) {
            window.addEventListener('scroll', () => {
                if (window.scrollY > 500) {
                    backToTopBtn.classList.add('visible');
                } else {
                    backToTopBtn.classList.remove('visible');
                }
            });

            backToTopBtn.addEventListener('click', () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }

        // Initialize
        fetchLeaderboard();
    });
})();
