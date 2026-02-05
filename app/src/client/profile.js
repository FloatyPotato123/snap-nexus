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
        comparedPlayers: [], // Array of { id, name, stats: [] }
        seasonChartInstance: null,
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
            UI.renderHistory(data.history || []);

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

    async function loadSeasonData(year, month) {
        try {
            const req = await fetch(`/api/player/${State.playerId}?month=${month}&year=${year}`);
            if (!req.ok) throw new Error("Failed to load season");
            const data = await req.json();
            State.primaryPlayerStats = data.currentSeasonStats || [];

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

            const historyList = [...history].sort((a, b) => new Date(b.seenAt) - new Date(a.seenAt));
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
            if (State.primaryPlayerStats.length > 0) {
                this.toggleChartDisplay('season', true);
                Charts.renderSeasonChart(State.primaryPlayerStats);
                this.updateAdvancedStats(State.primaryPlayerStats);
            } else {
                this.toggleChartDisplay('season', false);
                this.updateAdvancedStats([]);
            }
        },

        updateAdvancedStats(stats) {
            if (!stats || stats.length < 2) {
                // Need at least 2 days to compare
                $('pBestDayBadge').classList.add('d-none');
                $('pVolatilityBadge').classList.add('d-none');
                return;
            }

            // 1. Calculate Daily Deltas
            const deltas = [];
            for (let i = 1; i < stats.length; i++) {
                const prev = stats[i - 1].sp;
                const curr = stats[i].sp;
                if (prev > 0 && curr > 0) {
                    deltas.push(curr - prev);
                }
            }

            if (deltas.length === 0) {
                $('pBestDayBadge').classList.add('d-none');
                $('pVolatilityBadge').classList.add('d-none');
                return;
            }

            // 2. Daily Progress (Average Gain)
            const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
            const avgLabel = mean >= 0 ? `+${Math.round(mean).toLocaleString()}` : `${Math.round(mean).toLocaleString()}`;
            $('pVolatility').innerText = `${avgLabel} SP`;
            $('pVolatilityBadge').classList.remove('d-none');

            // 3. Best Day (Max Positive Gain)
            const maxGain = Math.max(...deltas);
            if (maxGain > 0) {
                $('pBestDay').innerText = `+${maxGain.toLocaleString()} SP`;
                $('pBestDayBadge').classList.remove('d-none');
            } else {
                $('pBestDayBadge').classList.add('d-none');
            }

            // Toggle parent container
            const hasSeasonStats = deltas.length > 0;
            $('pSeasonStats').classList.toggle('d-none', !hasSeasonStats);
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

        renderSeasonChart(stats) {
            const ctx = $('seasonChart').getContext('2d');
            if (State.seasonChartInstance) State.seasonChartInstance.destroy();

            const dateMap = new Set();
            stats.forEach(s => dateMap.add(s.date));
            State.comparedPlayers.forEach(p => (p.stats || []).forEach(s => dateMap.add(s.date)));
            const sortedDates = Array.from(dateMap).sort();

            const labels = sortedDates.map(dStr => {
                const [y, m, d] = dStr.split('-');
                return `${parseInt(m)}/${parseInt(d)}`;
            });

            const alignData = (sList, key) => sortedDates.map(dStr => sList.find(s => s.date === dStr)?.[key] || null);

            State.isComparing = State.comparedPlayers.length > 0;
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

                State.comparedPlayers.forEach((p, i) => {
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
                        y: this.getRankAxis(true),
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
                if (res.ok) player.stats = (await res.json()).currentSeasonStats || [];
            } catch (e) { }

            UI.renderComparedPlayersList();
            UI.updateSeasonChartUI();
        },

        removeComparedPlayer(id) {
            State.comparedPlayers = State.comparedPlayers.filter(p => p.id !== id);
            UI.renderComparedPlayersList();
            UI.updateSeasonChartUI();
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
            const { rankText, spText } = this.getHeaderStats(State, chartInstance);
            const { width, height, dpi, padding, headerHeight } = { width: 1200, height: 675, dpi: 2, padding: 30, headerHeight: rankText ? 160 : 120 };

            const canvas = document.createElement('canvas');
            canvas.width = width * dpi; canvas.height = height * dpi;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

            ctx.fillStyle = '#181c25'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            const chartCanvas = await this.renderHighResChart(chartInstance, width, height, headerHeight, padding, dpi);
            ctx.drawImage(chartCanvas, padding * dpi, headerHeight * dpi);
            this.drawHeader(ctx, State, rankText, spText, padding, dpi);

            return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        },

        getHeaderStats(State, chartInstance) {
            // Updated to fallback to first checked if radio
            const sSelect = document.querySelector('.season-check:checked');
            const selectedVal = sSelect ? sSelect.value : '';
            if (!selectedVal) return { rankText: null, spText: null };

            const [year, month] = selectedVal.split('-').map(Number);
            const active = SnapUtils.getCurrentSeason(new Date());
            const isCurrent = selectedVal === `${active.year}-${active.month}`;
            let rankText = null, spText = null;
            const rawStats = chartInstance.rawStats || [];

            if (isCurrent) {
                const pRank = $('pRank');
                if (pRank?.dataset.rank) {
                    rankText = "Rank " + pRank.dataset.rank;
                    if (pRank.dataset.sp) spText = parseInt(pRank.dataset.sp).toLocaleString() + " SP";
                }
            } else if (rawStats.length > 0) {
                const last = rawStats[rawStats.length - 1];
                const end = SnapUtils.getSeasonEndForMonth(year, month - 1), endStr = end.toISOString().split('T')[0];
                const prev = new Date(end); prev.setUTCDate(prev.getUTCDate() - 1);
                const prevStr = prev.toISOString().split('T')[0];
                if ((last.date === endStr || last.date === prevStr) && last.rank) {
                    rankText = "Rank " + last.rank;
                    if (last.sp) spText = last.sp.toLocaleString() + " SP";
                }
            }
            return { rankText, spText };
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

        drawHeader(ctx, State, rankText, spText, padding, dpi) {
            const name = $('pName').dataset.rawName || $('pName').innerText, season = document.querySelector('.season-check:checked')?.parentElement.querySelector('span').innerText || 'Season';

            ctx.textBaseline = 'top'; ctx.fillStyle = '#f8fafc'; ctx.font = `bold ${48 * dpi}px system-ui, sans-serif`; ctx.textAlign = 'left';
            ctx.fillText(name, padding * dpi, padding * dpi + (15 * dpi));
            ctx.fillStyle = '#94a3b8'; ctx.font = `${30 * dpi}px system-ui, sans-serif`; ctx.textAlign = 'right';
            ctx.fillText(season, (1200 - padding) * dpi, padding * dpi + (25 * dpi));

            if (rankText || spText) {
                ctx.textAlign = 'left'; let curX = padding * dpi; const y = padding * dpi + (75 * dpi);
                if (rankText) {
                    ctx.fillStyle = '#2196F3'; ctx.font = `bold ${32 * dpi}px system-ui, sans-serif`;
                    ctx.fillText(rankText, curX, y); curX += ctx.measureText(rankText).width + (25 * dpi);
                }
                if (spText) { ctx.fillStyle = '#ffcc00'; ctx.font = `bold ${32 * dpi}px system-ui, sans-serif`; ctx.fillText(spText, curX, y); }
            }
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
