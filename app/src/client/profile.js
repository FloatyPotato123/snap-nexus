/**
 * client/profile.js
 * Logic for the Player Profile page.
 */
(function () {
    const pathParts = window.location.pathname.split('/');
    const playerId = pathParts[pathParts.length - 1];
    let $; // Define $ in closure but init later

    const { CONSTANTS } = window.SnapUtils;

    // --- STATE ---
    const State = {
        playerId,
        primaryPlayerStats: [],
        comparedPlayers: [], // Array of { id, name, stats: [], liveStats: {} }
        liveStats: null,
        rollingHistory: null,
        seasonChartInstance: null,
        rollingChartInstance: null,
        historicalChartInstance: null,
        debounceTimer: null,
        isComparing: false
    };

    // --- INITIALIZATION ---
    function init() {
        try {
            // Initialize helpers safely
            if (typeof SnapUtils === 'undefined') throw new Error("SnapUtils library not loaded");
            $ = SnapUtils.$;

            SnapUtils.initChartDefaults();
            SnapUtils.initTabs();
            loadProfile();
            initCompareSearch();
            parseComparisonUrl();

            // ... global listeners ...
            // Global close for dropdowns
            document.addEventListener('click', (e) => {
                const searchContainer = $('compareSearchContainer');
                const searchToggle = $('toggleCompareBtn');
                const seasonDropdown = $('seasonDropdown');
                const seasonTrigger = $('seasonTrigger');

                // Search Tray
                if (searchContainer && !searchContainer.classList.contains('d-none')) {
                    if (!searchContainer.contains(e.target) && !searchToggle.contains(e.target)) {
                        SnapProfile.toggleCompareSearch(false);
                    }
                }

                // Season Dropdown
                if (seasonDropdown && seasonDropdown.style.display === 'block') {
                    if (!seasonDropdown.contains(e.target) && !seasonTrigger.contains(e.target)) {
                        seasonDropdown.style.display = 'none';
                    }
                }
            });

        } catch (e) {
            console.error("[Profile] Init failed:", e);
            const escapeHtml = SnapUtils.escapeHtml || ((s) => s);
            document.getElementById('loading').innerHTML = `<div class="error-msg">Init Crash: ${escapeHtml(e.message)}</div>`;
        }
    }

    // --- API / DATA ---
    async function loadProfile() {
        try {
            populateSeasonSelector();

            const req = await fetch(`${CONSTANTS.API.PLAYER_PROFILE}/${State.playerId}`);
            if (!req.ok) throw new Error("Player not found");
            const data = await req.json();

            UI.renderBasicInfo(data);
            State.liveStats = { rank: data.currentRank, sp: data.currentSP };
            UI.renderHistory(data.history || []);

            // 2. Load Rolling History (24h Window)
            try {
                const rollReq = await fetch(`/api/leaderboard/rolling?id=${State.playerId}`);
                if (rollReq.ok) {
                    const rollData = await rollReq.json();
                    let history = rollData.playerHistory || [];
                    const updatedAt = rollData.updatedAt || 0;

                    // Time-aware merging: if history is stale, fill with nulls up to 'now'
                    if (updatedAt > 0 && State.liveStats && State.liveStats.sp && State.liveStats.rank) {
                        const now = Date.now();
                        const diffMs = now - updatedAt;
                        const intervals = Math.floor(diffMs / (5 * 60 * 1000));

                        // If we are more than 1 interval behind, fill with nulls
                        if (intervals > 0) {
                            for (let i = 0; i < intervals; i++) {
                                history.push(null);
                            }
                        }

                        // Limit to 24h size (288 * 5 mins)
                        if (history.length > 288) {
                            history = history.slice(history.length - 288);
                        }

                        // Append live stats as the "now" point
                        history.push([State.liveStats.sp, State.liveStats.rank]);
                    }

                    State.rollingHistory = history;

                    if (State.rollingHistory.length > 0) {
                        UI.toggleChartDisplay('rolling', true);
                        Charts.renderRollingChart(State.rollingHistory);
                    } else {
                        UI.toggleChartDisplay('rolling', false);
                    }
                }
            } catch (e) {
                console.warn("[Profile] Failed to load rolling data:", e);
                UI.toggleChartDisplay('rolling', false);
            }

            if (data.currentSeasonStats?.length > 0) {
                State.primaryPlayerStats = data.currentSeasonStats;
                UI.updateSeasonChartUI();
            } else {
                UI.toggleChartDisplay('season', false);
            }

            if (data.historicalSeasonRanks?.length > 0) {
                UI.toggleChartDisplay('historical', true);
                Charts.renderHistoricalChart(data.historicalSeasonRanks);
            } else {
                UI.toggleChartDisplay('historical', false);
            }

            $('loading').style.display = 'none';
            $('content').classList.remove('d-none');
        } catch (e) {
            $('loading').innerText = ""; // Clear
            const { escapeHtml } = window.SnapUtils;
            $('loading').innerHTML = `<div class="error-msg">Load Error: ${escapeHtml(e.message)}</div>`;
            console.error(e);
        }
    }

    async function parseComparisonUrl() {
        const params = new URLSearchParams(window.location.search);
        const compareIds = params.get('compare');
        if (compareIds) {
            const ids = compareIds.split(',').filter(id => id && id !== State.playerId);
            // Load them sequentially to avoid UI overlapping (max 5)
            for (const id of ids.slice(0, 5)) {
                await SnapProfile.addComparedPlayer(id, "Loading...");
            }
        }
    }

    async function loadSeasonData(year, month) {
        try {
            const req = await fetch(`/api/player/${State.playerId}?month=${month}&year=${year}`);
            if (!req.ok) throw new Error("Failed to load season");
            const data = await req.json();
            State.primaryPlayerStats = data.currentSeasonStats || [];
            State.liveStats = { rank: data.currentRank, sp: data.currentSP };

            // Refresh comparisons for the new month
            await refreshComparisonData(year, month);
            UI.updateSeasonChartUI();
        } catch (e) {
            console.warn("[Profile] Error loading season data:", e);
        }
    }

    async function refreshComparisonData(year, month) {
        if (State.comparedPlayers.length === 0) return;

        const promises = State.comparedPlayers.map(async p => {
            try {
                const res = await fetch(`/api/player/${p.id}?month=${month}&year=${year}`);
                if (res.ok) {
                    const data = await res.json();
                    p.stats = data.currentSeasonStats || [];
                    p.liveStats = { rank: data.currentRank, sp: data.currentSP };
                }
            } catch (e) {
                console.warn(`[Profile] Failed to fetch comparison for ${p.name}`, e);
            }
        });
        await Promise.all(promises);
    }

    // --- UI HELPERS ---
    const UI = {
        renderBasicInfo(data) {
            $('pName').innerText = data.name;
            $('pName').dataset.rawName = data.name;
            $('pId').innerText = data.id;

            // Technical Metadata
            if ($('pMetaId')) {
                $('pMetaId').innerText = `REF_0x${data.id.substring(0, 8).toUpperCase()}`;
            }

            document.title = `${data.name} | Snap Nexus`;

            // Collision Warning
            const warning = document.getElementById('collisionWarning');
            if (data.isCollision) {
                if (warning) warning.classList.remove('d-none');
            } else {
                if (warning) warning.classList.add('d-none');
            }

            if (data.currentRank) {
                $('pCoreStats').classList.remove('d-none');
                $('pRank').innerText = data.currentRank;
                $('pRank').dataset.rank = data.currentRank;
                $('pRankBadge').classList.remove('d-none');

                if (data.currentSP) {
                    $('pRank').dataset.sp = data.currentSP;
                    $('pSP').innerText = parseInt(data.currentSP).toLocaleString();
                    $('pSPBadge').classList.remove('d-none');
                } else {
                    $('pSPBadge').classList.add('d-none');
                }
            } else {
                $('pCoreStats').classList.add('d-none');
                $('pRankBadge').classList.add('d-none');
                $('pSPBadge').classList.add('d-none');
            }
            // Advanced Stats
            this.updateAdvancedStats(State.primaryPlayerStats);
        },

        renderHistory(history) {
            const historyCard = $('pHistoryCard');

            // Hide if zero or only one entry (no changes to show)
            if (!history || history.length <= 1) {
                if (historyCard) historyCard.classList.add('d-none');
                return;
            }

            if (historyCard) historyCard.classList.remove('d-none');

            const currentName = ($('pName').dataset.rawName || '').toLowerCase().trim();
            const historyList = [...history]
                .filter(h => h.name && h.name.toLowerCase().trim() !== currentName)
                .sort((a, b) => new Date(b.seenAt) - new Date(a.seenAt));

            const { escapeHtml } = window.SnapUtils;
            let html = historyList.map((h, i) => {
                const isCurrent = i === 0;
                const isFirstKnown = i === historyList.length - 1;
                return `
                    <div class="timeline-item ${isCurrent ? 'current' : ''}">
                        <span class="timeline-name">${escapeHtml(h.name || 'Unknown')}</span>
                        ${h.seenAt && !isFirstKnown ? `<span class="timeline-date">${h.seenAt}</span>` : ''}
                    </div>
                `;
            }).join('');

            if (historyList.length === 0) {
                if (historyCard) historyCard.classList.add('d-none');
                return;
            }

            $('historyTimeline').innerHTML = html;
        },

        toggleChartDisplay(type, visible) {
            const chart = $(`${type}Chart`);
            const msg = $(`no${type.charAt(0).toUpperCase() + type.slice(1)}Stats`);
            const container = $(`${type}ChartContainer`);
            if (!chart || !msg || !container) return;

            if (visible) {
                chart.style.display = 'block';
                msg.classList.add('d-none');
                container.style.height = '350px';
            } else {
                chart.style.display = 'none';
                msg.classList.remove('d-none');
                container.style.height = 'auto';
            }
        },

        updateSeasonChartUI() {
            const isCurrent = this.isViewingCurrentSeason();
            let statsToRender = State.primaryPlayerStats;

            if (isCurrent && State.liveStats?.rank) {
                statsToRender = this.mergeLiveStats(statsToRender, State.liveStats);
            }

            if (statsToRender.length > 0) {
                this.toggleChartDisplay('season', true);

                const processedComparison = State.comparedPlayers.map(p => ({
                    ...p,
                    stats: (isCurrent && p.liveStats?.rank) ? this.mergeLiveStats(p.stats, p.liveStats) : p.stats
                }));

                Charts.renderSeasonChart(statsToRender, processedComparison);
                this.updateAdvancedStats(statsToRender);
            } else {
                this.toggleChartDisplay('season', false);
                this.updateAdvancedStats([]);
            }
        },

        // Helpers for live data integration
        isViewingCurrentSeason() {
            const checked = document.querySelector('.season-check:checked');
            if (!checked) return true; // Default to current if not yet populated
            const active = SnapUtils.getCurrentSeason(new Date());
            return checked.value === `${active.year}-${active.month}`;
        },

        mergeLiveStats(stats, liveStats) {
            if (!liveStats || !liveStats.rank) return stats;
            const today = new Date().toISOString().split('T')[0];
            const newStats = [...stats];
            const last = newStats[newStats.length - 1];

            // If the last snapshot is from today, replace it with the live data
            // Otherwise, append the live data as a new point
            if (last && last.date === today) {
                return newStats.slice(0, -1).concat({ date: today, rank: liveStats.rank, sp: liveStats.sp });
            } else {
                newStats.push({ date: today, rank: liveStats.rank, sp: liveStats.sp });
                return newStats;
            }
        },

        updateAdvancedStats(stats) {
            // Helper to get whole days between two date strings (YYYY-MM-DD)
            const daysBetween = (d2, d1) => Math.round((new Date(d2) - new Date(d1)) / 86400000);

            let allStats = [...(stats || [])];

            // 1. Inject live data if it's newer than the last recorded stat
            if (State.liveStats && State.liveStats.sp) {
                const today = new Date().toISOString().split('T')[0];
                const last = allStats.length > 0 ? allStats[allStats.length - 1] : null;

                if (!last || last.date < today) {
                    allStats.push({
                        date: today,
                        rank: State.liveStats.rank,
                        sp: State.liveStats.sp
                    });
                }
            }

            if (allStats.length < 2) {
                $('pBestDayBadge').classList.add('d-none');
                $('pVolatilityBadge').classList.add('d-none');
                return;
            }

            const first = allStats[0];
            const last = allStats[allStats.length - 1];

            // 2. Daily Average (Total Gain / Days Elapsed)
            const daysElapsed = daysBetween(last.date, first.date) || 1;
            const totalGain = (last.sp || 0) - (first.sp || 0);
            const mean = totalGain / daysElapsed;
            const avgLabel = mean >= 0 ? `+${Math.round(mean).toLocaleString()}` : `${Math.round(mean).toLocaleString()}`;

            $('pVolatility').innerText = `${avgLabel} SP`;
            $('pVolatilityBadge').classList.remove('d-none');

            // 3. Best Day (Max gain on a single day or normalized over gaps)
            const dailyDeltas = [];
            for (let i = 1; i < allStats.length; i++) {
                const prev = allStats[i - 1];
                const curr = allStats[i];
                const gap = daysBetween(curr.date, prev.date);

                if (gap > 0 && prev.sp > 0 && curr.sp > 0) {
                    const gain = curr.sp - prev.sp;
                    // If gap is 1 day, it's a true "Best Day"
                    // If gap > 1, we still count the average daily gain in that gap as a candidate
                    // but we cap the gap to avoid misleading spikes over many empty weeks
                    if (gap === 1) {
                        dailyDeltas.push(gain);
                    } else if (gap <= 7) {
                        dailyDeltas.push(gain / gap);
                    }
                }
            }

            const maxGain = dailyDeltas.length > 0 ? Math.max(...dailyDeltas) : 0;
            if (maxGain > 1) { // Only show if gain is significant (>1 SP)
                $('pBestDay').innerText = `+${Math.round(maxGain).toLocaleString()} SP`;
                $('pBestDayBadge').classList.remove('d-none');
            } else {
                $('pBestDayBadge').classList.add('d-none');
            }

            $('pSeasonStats').classList.remove('d-none');
        },

        updateSeasonTriggerText() {
            const checked = document.querySelector('.season-check:checked');
            const btnText = $('seasonTriggerText');
            if (btnText && checked) {
                btnText.innerText = checked.parentElement.querySelector('span').innerText;
            }
        },

        renderComparedPlayersList() {
            const list = $('comparedPlayersList');
            if (!list) return;

            const { escapeHtml } = window.SnapUtils;
            list.innerHTML = State.comparedPlayers.map((p, i) => {
                const color = SnapUtils.CHART_PALETTE[(i + 1) % SnapUtils.CHART_PALETTE.length];
                return `
                    <div class="comparison-tag">
                        <span class="color-dot" style="background-color: ${color.border}"></span>
                        ${escapeHtml(p.name)}
                        <span class="remove-btn" onclick="SnapProfile.removeComparedPlayer('${escapeHtml(p.id)}')">×</span>
                    </div>
                `;
            }).join('');
        },

        syncComparisonUrl() {
            const params = new URLSearchParams(window.location.search);
            if (State.comparedPlayers.length > 0) {
                const ids = State.comparedPlayers.map(p => p.id).join(',');
                params.set('compare', ids);
            } else {
                params.delete('compare');
            }
            const newSearch = params.toString();
            const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '');
            window.history.replaceState({ path: newUrl }, '', newUrl);
        }
    };

    // --- CHARTS ---
    const Charts = {
        // Shared logic to ensure Rank 1 label is always visible
        forceRankOneTick(axis) {
            axis.ticks = axis.ticks.filter(t => t.value >= 1);
            if (!axis.ticks.find(t => t.value === 1)) {
                axis.ticks.push({ value: 1, label: '1' });
                axis.ticks.sort((a, b) => a.value - b.value);
            }
        },

        getRankAxis(display = true) {
            return {
                type: 'linear', display, position: 'left', reverse: true,
                min: 0, suggestedMax: 100,
                title: { display: true, text: 'Rank', color: '#2196F3' },
                grid: { color: '#333' },
                ticks: {
                    color: '#2196F3',
                    // Let Chart.js decide optimal step size, but hide 0 and decimals
                    callback: (val) => (val <= 0 || val % 1 !== 0) ? null : val
                },
                afterBuildTicks: (axis) => this.forceRankOneTick(axis)
            };
        },

        getSPAxis(min, max, position = 'right', drawGrid = false) {
            return {
                type: 'linear', display: true, position,
                title: { display: true, text: 'Snap Points', color: '#ffcc00' },
                suggestedMin: min, suggestedMax: max,
                grid: { drawOnChartArea: drawGrid, color: '#333' },
                ticks: { color: '#ffcc00' }
            };
        },

        renderSeasonChart(stats, comparedOverride) {
            const ctx = $('seasonChart').getContext('2d');
            if (State.seasonChartInstance) State.seasonChartInstance.destroy();

            const comparedPlayers = comparedOverride || State.comparedPlayers;

            const dateMap = new Set();
            stats.forEach(s => dateMap.add(s.date));
            comparedPlayers.forEach(p => (p.stats || []).forEach(s => dateMap.add(s.date)));
            const sortedDates = Array.from(dateMap).sort();

            const labels = sortedDates.map(dStr => {
                const [y, m, d] = dStr.split('-');
                return `${parseInt(m)}/${parseInt(d)}`;
            });

            const alignData = (sList, key) => sortedDates.map(dStr => sList.find(s => s.date === dStr)?.[key] || null);

            State.isComparing = comparedPlayers.length > 0;
            let datasets = [];

            if (!State.isComparing) {
                const common = { tension: 0.3, borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#1e293b' };
                datasets = [
                    { ...common, label: 'Rank', data: alignData(stats, 'rank'), borderColor: '#2196F3', yAxisID: 'yRank', borderDash: [5, 5], clip: false },
                    { ...common, label: 'SP', data: alignData(stats, 'sp'), borderColor: '#ffcc00', backgroundColor: 'rgba(255, 204, 0, 0.1)', pointBackgroundColor: '#ffcc00', yAxisID: 'ySP', fill: true }
                ];
            } else {
                const primaryName = $('pName').dataset.rawName;
                const common = { tension: 0.3, borderWidth: 2, pointRadius: 3, fill: true };
                datasets.push({ ...common, label: primaryName, data: alignData(stats, 'sp'), borderColor: '#ffcc00', backgroundColor: 'rgba(255, 204, 0, 0.1)', pointBackgroundColor: '#ffcc00', yAxisID: 'ySP' });

                comparedPlayers.forEach((p, i) => {
                    const color = SnapUtils.CHART_PALETTE[(i + 1) % SnapUtils.CHART_PALETTE.length];
                    datasets.push({ ...common, label: p.name, data: alignData(p.stats || [], 'sp'), borderColor: color.border, backgroundColor: color.bg.replace('0.2)', '0.05)'), pointBackgroundColor: color.border, yAxisID: 'ySP' });
                });
            }

            let allSPs = [].concat(...datasets.filter(ds => ds.yAxisID === 'ySP').map(ds => ds.data)).filter(v => v > 0);
            let minSP, maxSP;
            if (allSPs.length > 0) {
                let dMin = Math.min(...allSPs), dMax = Math.max(...allSPs);
                if ((dMax - dMin) < 1000) { minSP = (dMax + dMin) / 2 - 500; maxSP = (dMax + dMin) / 2 + 500; }
            }

            State.seasonChartInstance = new Chart(ctx, {
                type: 'line',
                data: { labels, datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    layout: { padding: { top: 0 } },
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        x: { grid: { color: '#333' }, ticks: { color: '#aaa' } },
                        yRank: this.getRankAxis(!State.isComparing),
                        ySP: this.getSPAxis(minSP, maxSP, State.isComparing ? 'left' : 'right', State.isComparing)
                    },
                    plugins: { legend: { labels: { color: '#fff' } } }
                }
            });
            State.seasonChartInstance.rawStats = stats;
        },

        renderRollingChart(history) {
            const chartEl = $('rollingChart');
            if (!chartEl) return;
            const ctx = chartEl.getContext('2d');
            if (State.rollingChartInstance) State.rollingChartInstance.destroy();

            // Generate labels (HH:MM) chronologically ending at NOW
            const now = new Date();
            // Round down to nearest minute for stability
            now.setSeconds(0, 0);

            const labels = [];
            for (let i = history.length - 1; i >= 0; i--) {
                const d = new Date(now.getTime() - (i * 5 * 60 * 1000));
                labels.push(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            }

            const spData = history.map(h => h ? h[0] : null);
            const rankData = history.map(h => h ? h[1] : null);

            // Update 24h Summary in UI
            const summaryEl = $('rollingStatsSummary');
            if (summaryEl) {
                const valid = history.filter(h => h && h[0] !== null);
                if (valid.length >= 2) {
                    const start = valid[0];
                    const end = valid[valid.length - 1];
                    const spDelta = end[0] - start[0];
                    const rankDelta = start[1] - end[1];

                    const spDeltaStr = (spDelta >= 0 ? '+' : '') + spDelta.toLocaleString();
                    const rankDeltaStr = (rankDelta >= 0 ? '+' : '') + rankDelta.toLocaleString();

                    const spColor = '#ffcc00';
                    const rankColor = '#2196F3';

                    summaryEl.innerHTML = `
                        <div class="rolling-summary-flex">
                            <div class="rolling-summary-item">
                                <span class="label" style="color: ${rankColor}">Rank</span>
                                <div class="value">${rankDeltaStr} <span class="range">(#${start[1].toLocaleString()} → #${end[1].toLocaleString()})</span></div>
                            </div>
                            <div class="rolling-summary-item">
                                <span class="label" style="color: ${spColor}">SP</span>
                                <div class="value">${spDeltaStr} <span class="range">(${start[0].toLocaleString()} → ${end[0].toLocaleString()})</span></div>
                            </div>
                        </div>
                    `;
                    summaryEl.classList.remove('d-none');
                } else {
                    summaryEl.classList.add('d-none');
                }
            }

            let allSPs = spData.filter(v => v !== null);
            let minSP, maxSP;
            if (allSPs.length > 0) {
                let dMin = Math.min(...allSPs), dMax = Math.max(...allSPs);
                // Buffer for visual clarity
                minSP = dMin - 50;
                maxSP = dMax + 50;
                // Ensure at least a 500 SP range for a "flatter" look if change is small
                if (maxSP - minSP < 500) {
                    const center = (maxSP + minSP) / 2;
                    minSP = center - 250;
                    maxSP = center + 250;
                }
            }

            const isMobile = window.innerWidth < 640;

            State.rollingChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Rank',
                            data: rankData,
                            borderColor: '#2196F3',
                            yAxisID: 'yRank',
                            borderDash: [5, 5],
                            tension: 0.3,
                            pointRadius: 0,
                            clip: false
                        },
                        {
                            label: 'SP',
                            data: spData,
                            borderColor: '#ffcc00',
                            backgroundColor: 'rgba(255, 204, 0, 0.1)',
                            pointBackgroundColor: '#ffcc00',
                            yAxisID: 'ySP',
                            fill: true,
                            tension: 0.3,
                            pointRadius: 0,
                            pointHitRadius: 10
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    layout: { padding: { right: isMobile ? 8 : 4 } },
                    scales: {
                        x: {
                            grid: { color: '#333' },
                            ticks: {
                                color: '#aaa',
                                maxRotation: 0,
                                autoSkip: false, // Turn off autoSkip to take manual control
                                font: { size: isMobile ? 10 : 12 },
                                callback: function (val, index) {
                                    // Manually determine which labels to show
                                    const total = labels.length;
                                    const numTicks = isMobile ? 6 : 8; // Changed from 4 to 6

                                    if (total <= numTicks) return this.getLabelForValue(val);

                                    // We want to guarantee index 0 (oldest) and index total-1 (newest)
                                    // Then evenly space the remaining ticks
                                    const step = (total - 1) / (numTicks - 1);

                                    // Check if this index is one of our target indices (allow slight rounding slop)
                                    for (let i = 0; i < numTicks; i++) {
                                        if (Math.abs(index - Math.round(i * step)) < 0.5) {
                                            return this.getLabelForValue(val);
                                        }
                                    }
                                    return null;
                                }
                            }
                        },
                        yRank: {
                            ...this.getRankAxis(true),
                            title: { display: true, text: 'Rank', color: '#2196F3' },
                            ticks: {
                                ...this.getRankAxis(true).ticks,
                                font: { size: isMobile ? 10 : 12 }
                            }
                        },
                        ySP: {
                            ...this.getSPAxis(minSP, maxSP, 'right', false),
                            title: { display: true, text: 'Snap Points', color: '#ffcc00' },
                            ticks: {
                                color: '#ffcc00',
                                font: { size: isMobile ? 10 : 12 }
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            labels: { color: '#fff' }
                        }
                    }
                }
            });
            State.rollingChartInstance.rawHistory = history;
        },

        renderHistoricalChart(stats) {
            const ctx = $('historicalChart').getContext('2d');
            if (State.historicalChartInstance) State.historicalChartInstance.destroy();

            const spValues = stats.map(s => s.sp).filter(v => v > 0);
            let minSP, maxSP;
            if (spValues.length > 0) {
                let dMin = Math.min(...spValues), dMax = Math.max(...spValues);
                if ((dMax - dMin) < 1000) { minSP = (dMax + dMin) / 2 - 500; maxSP = (dMax + dMin) / 2 + 500; }
            }

            const common = { tension: 0.2, clip: false };
            State.historicalChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: stats.map(s => s.season),
                    datasets: [
                        { ...common, label: 'Season End Rank', data: stats.map(s => s.rank), borderColor: '#2196F3', yAxisID: 'y', borderDash: [5, 5] },
                        { ...common, label: 'Season End SP', data: stats.map(s => s.sp), borderColor: '#ffcc00', backgroundColor: 'rgba(255, 204, 0, 0.1)', yAxisID: 'y1', fill: true }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    layout: { padding: { top: 0 } },
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        x: { grid: { color: '#333' }, ticks: { color: '#aaa' } },
                        y: {
                            ...this.getRankAxis(true),
                            suggestedMax: undefined // Let historical ranks scale freely
                        },
                        y1: this.getSPAxis(minSP, maxSP, 'right', false)
                    }
                }
            });
        }
    };

    // --- SEARCH / COMPARE ---
    function initCompareSearch() {
        const input = $('compareSearchInput');
        const box = $('compareSuggestions');
        if (!input || !box) return;

        // Use shared autocomplete function
        const { createPlayerAutocomplete } = window.SnapUtils;

        createPlayerAutocomplete(input, box, {
            excludeId: State.playerId, // Don't show current player in results
            onSelect: async (player) => {
                await SnapProfile.addComparedPlayer(player.id, player.name);
                input.value = '';
                SnapProfile.toggleCompareSearch(false);
            }
        });

        // Escape key handling
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                box.style.display = 'none';
                SnapProfile.toggleCompareSearch(false);
            }
        });
    }

    function populateSeasonSelector() {
        const container = $('seasonDropdown');
        if (!container || container.children.length > 0) return;

        const now = new Date();
        const active = SnapUtils.getCurrentSeason(now);
        const months = SnapUtils.CONSTANTS.MONTHS;

        const addItem = (val, text, isDefault) => {
            const div = document.createElement('div');
            div.className = 'season-dropdown-item';
            div.innerHTML = `
                <label>
                    <input type="radio" name="season-group" value="${val}" class="season-check" ${isDefault ? 'checked' : ''} onchange="SnapProfile.handleSeasonChange()">
                    <span>${text}</span>
                </label>
            `;
            container.appendChild(div);
        };

        let y = active.year, m = active.month - 1;
        addItem(`${y}-${m + 1}`, `${months[m]} ${y}`, true);

        // Previous months
        if (--m < 0) { m = 11; y--; }
        while (y > CONSTANTS.DATA_START_YEAR || (y === CONSTANTS.DATA_START_YEAR && m >= CONSTANTS.DATA_START_MONTH)) {
            addItem(`${y}-${m + 1}`, `${months[m]} ${y}`, false);
            if (--m < 0) { m = 11; y--; }
        }

        UI.updateSeasonTriggerText();
    }

    // --- PUBLIC API ---
    window.SnapProfile = {
        async addComparedPlayer(id, name) {
            if (State.comparedPlayers.some(p => p.id === id)) return;
            if (State.comparedPlayers.length >= 5) return alert("Maximum 5 players.");

            const player = { id, name, stats: [] };
            State.comparedPlayers.push(player);

            const checked = document.querySelector('.season-check:checked');
            const [year, month] = (checked ? checked.value : `${new Date().getFullYear()}-${new Date().getMonth() + 1}`).split('-');
            try {
                const res = await fetch(`/api/player/${id}?month=${month}&year=${year}`);
                if (res.ok) {
                    const data = await res.json();
                    player.name = data.name || player.name; // Update from API (fixes "Loading..." on reload)
                    player.stats = data.currentSeasonStats || [];
                    player.liveStats = { rank: data.currentRank, sp: data.currentSP };
                }
            } catch (e) { }

            UI.renderComparedPlayersList();
            UI.updateSeasonChartUI();
            UI.syncComparisonUrl();
        },

        removeComparedPlayer(id) {
            State.comparedPlayers = State.comparedPlayers.filter(p => p.id !== id);
            UI.renderComparedPlayersList();
            UI.updateSeasonChartUI();
            UI.syncComparisonUrl();
        },

        toggleCompareSearch(show) {
            const container = $('compareSearchContainer');
            const toggleBtn = $('toggleCompareBtn');
            const input = $('compareSearchInput');
            if (!container || !toggleBtn) return;

            const isHidden = container.classList.contains('d-none');
            const shouldShow = show !== undefined ? show : isHidden;

            if (shouldShow) {
                container.classList.remove('d-none');
                toggleBtn.querySelector('span').innerText = 'Close';
                toggleBtn.querySelector('svg').innerHTML = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';
                if (input) input.focus();
            } else {
                container.classList.add('d-none');
                toggleBtn.querySelector('span').innerText = 'Compare';
                toggleBtn.querySelector('svg').innerHTML = '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>';
            }
        },

        toggleSeasonDropdown() {
            const dd = $('seasonDropdown');
            const isOpen = dd.style.display === 'block';
            dd.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) { SnapProfile.toggleCompareSearch(false); }
        },

        handleSeasonChange() {
            const checked = document.querySelector('.season-check:checked');
            if (checked) {
                UI.updateSeasonTriggerText();
                loadSeasonData(...checked.value.split('-'));
                $('seasonDropdown').style.display = 'none';
            }
        },

        copySeasonGraphImage() {
            Exporter.exportChart(State, State.seasonChartInstance);
        },

        copyRollingGraphImage() {
            Exporter.exportRollingChart(State, State.rollingChartInstance);
        }
    };

    // --- EXPORTER (High-Res Share Image) ---
    const Exporter = {
        async exportChart(State, chartInstance) {
            const btn = $('shareSeasonGraphBtn');
            const icon = $('copyIcon');
            const successIcon = $('copySuccessIcon');
            const errorIcon = $('copyErrorIcon');

            if (!btn || !icon) return;

            btn.setAttribute('aria-busy', 'true');
            btn.disabled = true;

            const showIcon = (type) => {
                icon.classList.add('d-none');
                if (successIcon) successIcon.classList.add('d-none');
                if (errorIcon) errorIcon.classList.add('d-none');

                if (type === 'success' && successIcon) successIcon.classList.remove('d-none');
                else if (type === 'error' && errorIcon) errorIcon.classList.remove('d-none');
                else icon.classList.remove('d-none');
            };

            try {
                if (!chartInstance) throw new Error("No chart to copy");

                // We use ClipboardItem with a Promise for the blob. 
                // This keeps the user gesture 'alive' on mobile/Safari.
                const promise = this.generateBlob(State, chartInstance);
                const item = new ClipboardItem({
                    'image/png': promise
                });

                await navigator.clipboard.write([item]);

                // Success
                showIcon('success');
                btn.classList.add('success');
                setTimeout(() => {
                    showIcon('default');
                    btn.classList.remove('success');
                }, 2500);
            } catch (e) {
                console.error("Export failed:", e);
                // Error
                showIcon('error');
                btn.classList.add('error');
                alert("Could not copy: " + (e.message || "Unknown error"));
                setTimeout(() => {
                    showIcon('default');
                    btn.classList.remove('error');
                }, 2500);
            } finally {
                btn.removeAttribute('aria-busy');
                btn.disabled = false;
            }
        },

        async generateBlob(State, chartInstance) {
            const playerStats = this.getHeaderStats(State, chartInstance);
            const isComparison = playerStats.length > 1;

            // Calculate header height based on number of players
            let headerHeight = 120;
            if (isComparison) {
                if (playerStats.length <= 3) headerHeight = 130; // Final tightening
                else headerHeight = 170; // Ultra-compact 2-row
            } else if (playerStats[0]?.rankText) {
                headerHeight = 130; // Same for single player w/ rank
            }

            const { width, height, dpi, padding } = { width: 1200, height: 675, dpi: 2, padding: 30 };

            const canvas = document.createElement('canvas');
            canvas.width = width * dpi; canvas.height = height * dpi;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

            ctx.fillStyle = '#181c25'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            const chartCanvas = await this.renderHighResChart(chartInstance, width, height, headerHeight, padding, dpi);
            ctx.drawImage(chartCanvas, padding * dpi, headerHeight * dpi);
            this.drawHeader(ctx, State, playerStats, padding, dpi);

            return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        },

        getHeaderStats(State, chartInstance) {
            const sSelect = document.querySelector('.season-check:checked');
            const selectedVal = sSelect ? sSelect.value : '';
            if (!selectedVal) return [];

            const [year, month] = selectedVal.split('-').map(Number);
            const active = SnapUtils.getCurrentSeason(new Date());
            const isCurrent = selectedVal === `${active.year}-${active.month}`;
            const results = [];

            // 1. Primary Player
            const primaryName = $('pName').dataset.rawName || $('pName').innerText;
            const stats = { name: primaryName, color: '#ffcc00', rankText: null, spText: null };

            if (isCurrent) {
                const pRank = $('pRank');
                if (pRank?.dataset.rank) {
                    stats.rankText = "Rank " + pRank.dataset.rank;
                    if (pRank.dataset.sp) stats.spText = parseInt(pRank.dataset.sp).toLocaleString() + " SP";
                }
            } else {
                const rawStats = chartInstance.rawStats || [];
                if (rawStats.length > 0) {
                    const last = rawStats[rawStats.length - 1];
                    const end = SnapUtils.getSeasonEndForMonth(year, month - 1), endStr = end.toISOString().split('T')[0];
                    const prev = new Date(end); prev.setUTCDate(prev.getUTCDate() - 1);
                    const prevStr = prev.toISOString().split('T')[0];
                    if ((last.date === endStr || last.date === prevStr) && last.rank) {
                        stats.rankText = "Rank " + last.rank;
                        if (last.sp) stats.spText = last.sp.toLocaleString() + " SP";
                    }
                }
            }
            results.push(stats);

            // 2. Compared Players
            State.comparedPlayers.forEach((p, i) => {
                const color = SnapUtils.CHART_PALETTE[(i + 1) % SnapUtils.CHART_PALETTE.length].border;
                const pStats = { name: p.name, color, rankText: null, spText: null };

                if (isCurrent && p.liveStats?.rank) {
                    pStats.rankText = "Rank " + p.liveStats.rank;
                    if (p.liveStats.sp) pStats.spText = parseInt(p.liveStats.sp).toLocaleString() + " SP";
                } else if (!isCurrent && p.stats?.length > 0) {
                    const last = p.stats[p.stats.length - 1];
                    const end = SnapUtils.getSeasonEndForMonth(year, month - 1), endStr = end.toISOString().split('T')[0];
                    const prev = new Date(end); prev.setUTCDate(prev.getUTCDate() - 1);
                    const prevStr = prev.toISOString().split('T')[0];
                    if ((last.date === endStr || last.date === prevStr) && last.rank) {
                        pStats.rankText = "Rank " + last.rank;
                        if (last.sp) pStats.spText = last.sp.toLocaleString() + " SP";
                    }
                }
                results.push(pStats);
            });

            return results;
        },

        async renderHighResChart(chartInstance, width, height, headerHeight, padding, dpi) {
            const tempCanvas = document.createElement('canvas');
            const cWidth = width - (padding * 2), cHeight = height - headerHeight - padding;
            tempCanvas.width = cWidth * dpi; tempCanvas.height = cHeight * dpi;

            // Robust Config Cloning
            const originalConfig = chartInstance.config;
            const newConfig = {
                type: originalConfig.type,
                data: JSON.parse(JSON.stringify(originalConfig.data)), // Deep copy data
                options: {
                    ...(originalConfig.options || {}),
                    responsive: false,
                    maintainAspectRatio: false,
                    devicePixelRatio: 1, // Fix: Prevent double scaling (we manually scale fonts/layout by dpi)
                    // Use onComplete callback for rendering
                    animation: {
                        duration: 0,
                        onComplete: () => { /* Handled by promise */ }
                    },
                    plugins: {
                        ...(originalConfig.options?.plugins || {}),
                        legend: {
                            ...(originalConfig.options?.plugins?.legend || {}),
                            labels: { ...(originalConfig.options?.plugins?.legend?.labels || {}) }
                        }
                    },
                    scales: { ...(originalConfig.options?.scales || {}) }
                }
            };

            const scale = (obj, size) => {
                if (!obj) return;
                if (!obj.font) obj.font = {};
                obj.font.size = size * dpi; obj.font.family = "'Inter', system-ui, sans-serif";
            };

            const opt = newConfig.options;
            Object.values(opt.scales || {}).forEach(s => {
                if (s.ticks) {
                    scale(s.ticks, 14);
                    s.ticks.padding = 10 * dpi;
                }
                if (s.title) scale(s.title, 16);
            });

            if (opt.plugins?.legend?.labels) {
                scale(opt.plugins.legend.labels, 14);
                opt.plugins.legend.labels.boxWidth = 40 * dpi;
                opt.plugins.legend.labels.padding = 20 * dpi;
            }

            newConfig.data.datasets.forEach(ds => {
                ds.borderWidth = 2.5 * dpi;
                if (ds.pointRadius) ds.pointRadius *= dpi;
                ds.pointBorderWidth = (ds.pointBorderWidth || 1) * dpi;
                if (ds.borderDash) ds.borderDash = ds.borderDash.map(v => v * dpi);
            });

            // Promisify the rendering
            return new Promise((resolve) => {
                newConfig.options.animation.onComplete = () => {
                    resolve(tempCanvas);
                };
                const tempChart = new Chart(tempCanvas.getContext('2d'), newConfig);
                // Safety timeout in case onComplete doesn't fire (e.g. if no data)
                setTimeout(() => resolve(tempCanvas), 2000);
            });
        },

        drawHeader(ctx, State, playerStats, padding, dpi) {
            const season = document.querySelector('.season-check:checked')?.parentElement.querySelector('span').innerText || 'Season';
            const isComparison = playerStats.length > 1;

            // Draw Season (Right Aligned)
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#94a3b8';
            ctx.font = `${30 * dpi}px system-ui, sans-serif`;
            ctx.textAlign = 'right';
            ctx.fillText(season, (1200 - padding) * dpi, padding * dpi + (25 * dpi));

            if (!isComparison) {
                // Single Player Layout (Large Name)
                const p = playerStats[0];
                if (!p) return;
                ctx.textAlign = 'left';
                ctx.fillStyle = '#f8fafc';
                ctx.font = `bold ${54 * dpi}px system-ui, sans-serif`;
                ctx.fillText(p.name, padding * dpi, padding * dpi + (15 * dpi));

                if (p.rankText || p.spText) {
                    let curX = padding * dpi;
                    const y = padding * dpi + (80 * dpi);
                    if (p.rankText) {
                        ctx.fillStyle = '#2196F3';
                        ctx.font = `bold ${36 * dpi}px system-ui, sans-serif`;
                        ctx.fillText(p.rankText, curX, y);
                        curX += ctx.measureText(p.rankText).width + (30 * dpi);
                    }
                    if (p.spText) {
                        ctx.fillStyle = '#ffcc00';
                        ctx.font = `bold ${36 * dpi}px system-ui, sans-serif`;
                        ctx.fillText(p.spText, curX, y);
                    }
                }
            } else {
                // Comparison Layout (Stacked: Name, then Stats below)
                ctx.textAlign = 'left';
                let curX = padding * dpi;
                let curY = padding * dpi + (15 * dpi);
                const colWidth = 330 * dpi;

                const isMultiRow = playerStats.length > 3;
                const nameSize = isMultiRow ? 28 : 38;
                const statsSize = isMultiRow ? 20 : 26;

                playerStats.forEach((p, i) => {
                    // Check if we need to wrap to next line
                    if (i > 0 && i % 3 === 0) {
                        curX = padding * dpi;
                        curY += 75 * dpi; // Ultra-compact row spacing
                    }

                    // 1. Draw Player Name
                    ctx.fillStyle = '#f8fafc';
                    ctx.font = `bold ${nameSize * dpi}px system-ui, sans-serif`;
                    ctx.fillText(p.name, curX, curY);

                    // 2. Draw Rank/SP below (in player's color)
                    ctx.fillStyle = p.color;
                    ctx.font = `bold ${statsSize * dpi}px system-ui, sans-serif`;
                    const statsLabel = (p.rankText && p.spText) ? `${p.rankText} · ${p.spText}` : 'Infinite';
                    ctx.fillText(statsLabel, curX, curY + ((isMultiRow ? 30 : 45) * dpi));

                    // Move to next "column"
                    curX += colWidth;
                });
            }
        },

        async exportRollingChart(State, chartInstance) {
            const btn = $('shareRollingGraphBtn');
            const icon = $('copyRollingIcon');
            const successIcon = $('copyRollingSuccessIcon');
            const errorIcon = $('copyRollingErrorIcon');

            if (!btn || !icon) return;

            btn.setAttribute('aria-busy', 'true');
            btn.disabled = true;

            const showIcon = (type) => {
                icon.classList.add('d-none');
                if (successIcon) successIcon.classList.add('d-none');
                if (errorIcon) errorIcon.classList.add('d-none');

                if (type === 'success' && successIcon) successIcon.classList.remove('d-none');
                else if (type === 'error' && errorIcon) errorIcon.classList.remove('d-none');
                else icon.classList.remove('d-none');
            };

            try {
                if (!chartInstance) throw new Error("No chart to copy");

                const promise = this.generateRollingBlob(State, chartInstance);
                const item = new ClipboardItem({
                    'image/png': promise
                });

                await navigator.clipboard.write([item]);

                // Success
                showIcon('success');
                btn.classList.add('success');
                setTimeout(() => {
                    showIcon('default');
                    btn.classList.remove('success');
                }, 2500);
            } catch (e) {
                console.error("Rolling export failed:", e);
                showIcon('error');
                btn.classList.add('error');
                alert("Could not copy 24h graph: " + (e.message || "Unknown error"));
                setTimeout(() => {
                    showIcon('default');
                    btn.classList.remove('error');
                }, 2500);
            } finally {
                btn.removeAttribute('aria-busy');
                btn.disabled = false;
            }
        },

        async generateRollingBlob(State, chartInstance) {
            const stats = this.getRollingHeaderStats(State, chartInstance);
            const { width, height, dpi, padding } = { width: 1200, height: 600, dpi: 2, padding: 30 };
            const headerHeight = 135;

            const canvas = document.createElement('canvas');
            canvas.width = width * dpi; canvas.height = height * dpi;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

            ctx.fillStyle = '#181c25'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            const chartCanvas = await this.renderHighResChart(chartInstance, width, height, headerHeight, padding, dpi);
            ctx.drawImage(chartCanvas, padding * dpi, headerHeight * dpi);
            this.drawRollingHeader(ctx, stats, padding, dpi);

            return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        },

        getRollingHeaderStats(State, chartInstance) {
            const history = chartInstance.rawHistory || [];
            const primaryName = $('pName').dataset.rawName || $('pName').innerText;

            // Filter out nulls to find start and end
            const valid = history.filter(h => h && h[0] !== null);
            if (valid.length < 1) return { name: primaryName };

            const start = valid[0];
            const end = valid[valid.length - 1];

            const spDelta = end[0] - start[0];
            const rankDelta = start[1] - end[1];

            // Calculate date range
            const now = new Date();
            const getD = (idx) => new Date(now.getTime() - (history.length - 1 - idx) * 5 * 60 * 1000);
            const firstDate = getD(history.indexOf(start));
            const lastDate = getD(history.indexOf(end));
            const fmt = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
            const dateStr = fmt(firstDate) === fmt(lastDate) ? fmt(firstDate) : `${fmt(firstDate)} → ${fmt(lastDate)}`;

            return {
                name: primaryName,
                dateRange: dateStr,
                sp: { start: start[0], end: end[0], delta: spDelta },
                rank: { start: start[1], end: end[1], delta: rankDelta }
            };
        },

        drawRollingHeader(ctx, stats, padding, dpi) {
            // Draw Date Range (Right Aligned)
            ctx.textBaseline = 'top';
            ctx.fillStyle = '#94a3b8';
            ctx.font = `${28 * dpi}px system-ui, sans-serif`;
            ctx.textAlign = 'right';
            ctx.fillText(stats.dateRange || "Last 24 Hours", (1200 - padding) * dpi, padding * dpi + (25 * dpi));

            // Draw Player Name
            ctx.textAlign = 'left';
            ctx.fillStyle = '#f8fafc';
            ctx.font = `bold ${54 * dpi}px system-ui, sans-serif`;
            ctx.fillText(stats.name, padding * dpi, padding * dpi + (15 * dpi));

            // Draw Delta Line
            let curX = padding * dpi;
            const y = padding * dpi + (80 * dpi);

            if (stats.sp && stats.sp.end) {
                const deltaPrefix = stats.sp.delta >= 0 ? '+' : '';
                
                // Draw SP Label (Gold)
                ctx.fillStyle = '#ffcc00';
                ctx.font = `bold ${24 * dpi}px system-ui, sans-serif`;
                ctx.fillText("SP:", curX, y + (3 * dpi)); 
                curX += ctx.measureText("SP:").width + (10 * dpi);

                // Draw SP Section (Fully colored Gold)
                ctx.fillStyle = '#ffcc00';
                ctx.font = `bold ${24 * dpi}px system-ui, sans-serif`;
                ctx.fillText("SP:", curX, y + (3 * dpi)); 
                curX += ctx.measureText("SP:").width + (10 * dpi);

                ctx.font = `bold ${28 * dpi}px system-ui, sans-serif`;
                const valText = `${deltaPrefix}${stats.sp.delta.toLocaleString()} (${stats.sp.start.toLocaleString()} → ${stats.sp.end.toLocaleString()})`;
                ctx.fillText(valText, curX, y);
                curX += ctx.measureText(valText).width + (50 * dpi); // Padding between sections
            }

            if (stats.rank && stats.rank.end) {
                const deltaPrefix = stats.rank.delta >= 0 ? '+' : '';
                
                // Draw RANK Section (Fully colored Blue)
                ctx.fillStyle = '#2196F3';
                ctx.font = `bold ${24 * dpi}px system-ui, sans-serif`;
                ctx.fillText("RANK:", curX, y + (3 * dpi));
                curX += ctx.measureText("RANK:").width + (10 * dpi);

                ctx.font = `bold ${28 * dpi}px system-ui, sans-serif`;
                const valText = `${deltaPrefix}${stats.rank.delta.toLocaleString()} (#${stats.rank.start.toLocaleString()} → #${stats.rank.end.toLocaleString()})`;
                ctx.fillText(valText, curX, y);
            }
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
