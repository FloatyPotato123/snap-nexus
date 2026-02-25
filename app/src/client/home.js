/**
 * client/home.js
 * Logic for the Home Dashboard (index.html).
 */
(function () {
    const { $, CONSTANTS, getSeasonDuration, getSeasonColor, animateValue, escapeHtml, initChartDefaults, initTabs } = window.SnapUtils;

    // --- DASHBOARD NAMESPACE ---
    window.Home = {
        chartInstance: null,
        historyChartInstance: null,
        cachedHistory: null,

        // --- GLOBAL ACTIONS ---
        toggleSeasonDropdown: () => {
            const dd = $('seasonDropdown');
            if (!dd) return;
            const isOpen = dd.style.display === 'block';
            dd.style.display = isOpen ? 'none' : 'block';
        },

        handleSeasonChange: () => {
            window.Home.updateTriggerText();
            window.Home.loadSeasonChart();
        },

        setHistoryView: (view) => {
            const btnTotal = $('btnTotal');
            const btnAvg = $('btnAvg');
            if (btnTotal) btnTotal.classList.toggle('active', view === 'total');
            if (btnAvg) btnAvg.classList.toggle('active', view === 'avg');
            window.Home.loadHistoryChart();
        },

        // --- INTERNAL UTILS ---
        updateTriggerText: () => {
            const checked = document.querySelectorAll('.season-check:checked');
            const btnText = $('seasonTriggerText');
            if (!btnText) return;

            if (checked.length === 0) {
                btnText.innerText = 'Select Season...';
            } else if (checked.length === 1) {
                const label = checked[0].nextElementSibling.innerText;
                btnText.innerText = label;
            } else {
                btnText.innerText = `Comparing ${checked.length} Seasons`;
            }
        },

        setLoading: (id, isLoading) => {
            const el = $(id);
            if (el) el.style.opacity = isLoading ? '0.4' : '1';
        },

        // Placeholders to be filled in DOMContentLoaded
        loadSeasonChart: () => Promise.resolve(),
        loadHistoryChart: () => Promise.resolve()
    };

    // Keep legacy global names for HTML onclick compatibility
    window.toggleSeasonDropdown = window.Home.toggleSeasonDropdown;
    window.handleSeasonChange = window.Home.handleSeasonChange;
    window.setHistoryView = window.Home.setHistoryView;

    // Wait for DOM and Dependencies
    window.addEventListener('DOMContentLoaded', async () => {
        if (typeof window.SnapUtils === 'undefined' || typeof Chart === 'undefined') {
            console.error("Missing dependencies: SnapUtils or Chart.js");
            return;
        }

        // --- CHART UTILS ---

        function getChartOptions(useRelativeAxis) {
            return {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 1000, easing: 'easeOutQuart' },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: useRelativeAxis, labels: { color: '#f0f0f0', font: { weight: 'bold' } } },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        titleFont: { size: 13 },
                        bodyFont: { size: 12 },
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            title: (items) => useRelativeAxis ? `Day ${items[0].dataIndex + 1}` : items[0].label
                        }
                    }
                },
                scales: {
                    y: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#888', font: { size: 11 } },
                        title: { display: true, text: 'Players', color: '#f0f0f0' }
                    },
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#888', font: { size: 11 } },
                        title: { display: true, text: useRelativeAxis ? 'Day of Season' : 'Date (M/D)', color: '#f0f0f0' }
                    }
                }
            };
        }

        async function fetchSeasonData(season, now) {
            let year, month;
            if (!season.val || season.val === 'current') {
                const active = window.SnapUtils.getCurrentSeason(now);
                year = active.year;
                month = active.month;
            } else {
                [year, month] = season.val.split('-').map(Number);
            }

            const start = window.SnapUtils.getSeasonStartForMonth(year, month - 1);
            start.setDate(start.getDate() + 1);
            const end = window.SnapUtils.getSeasonEndForMonth(year, month - 1);

            let fetchEnd = end;
            const active = window.SnapUtils.getCurrentSeason(now);
            if (year === active.year && month === active.month) fetchEnd = now;

            const sStr = start.toISOString().split('T')[0];
            const eStr = fetchEnd.toISOString().split('T')[0];

            try {
                const req = await fetch(`${CONSTANTS.API.SEASON_STATS}?start=${sStr}&end=${eStr}`);
                const data = await req.json();
                return { ...season, data, year, month, start };
            } catch { return null; }
        }

        // --- DEFINE CHART LOADERS ---

        window.Home.loadSeasonChart = async () => {
            try {
                const checkboxes = Array.from(document.querySelectorAll('.season-check:checked'));
                if (checkboxes.length === 0) {
                    if (window.Home.chartInstance) window.Home.chartInstance.destroy();
                    $('seasonChart').style.display = 'none';
                    $('noSeasonData').style.display = 'block';
                    return;
                }

                window.Home.setLoading('seasonChartContainer', true);

                const seasonsToFetch = checkboxes.map(cb => ({
                    val: cb.value,
                    label: cb.nextElementSibling.innerText
                }));

                const useRelativeAxis = seasonsToFetch.length > 1;
                const now = new Date();

                const results = (await Promise.all(
                    seasonsToFetch.map(s => fetchSeasonData(s, now))
                )).filter(r => r && r.data && r.data.length > 0);

                if (results.length === 0) {
                    window.Home.setLoading('seasonChartContainer', false);
                    return;
                }

                $('seasonChart').style.display = 'block';
                $('noSeasonData').style.display = 'none';
                $('seasonChartContainer').style.height = CONSTANTS.CHART_HEIGHT;

                const ctx = $('seasonChart').getContext('2d');
                if (window.Home.chartInstance) window.Home.chartInstance.destroy();

                const processedDatasets = results.map(res => {
                    const points = res.data.map(d => {
                        let x, y = d.total;
                        if (useRelativeAxis) {
                            const startMs = res.start.getTime();
                            const dateMs = new Date(d.date).getTime();
                            x = Math.round((dateMs - startMs) / (1000 * 60 * 60 * 24));
                        } else {
                            x = d.date.slice(5).replace('-', '/');
                        }
                        return { x, y };
                    });
                    return { ...res, points };
                });

                let labels;
                if (useRelativeAxis) {
                    let maxDay = 0;
                    processedDatasets.forEach(d => d.points.forEach(p => maxDay = Math.max(maxDay, p.x)));
                    maxDay = Math.max(maxDay, 28);
                    labels = Array.from({ length: maxDay + 1 }, (_, i) => `Day ${i + 1}`);
                } else {
                    labels = processedDatasets[0].points.map(p => p.x);
                }

                const chartDatasets = processedDatasets.map((res) => {
                    const color = getSeasonColor(res.year, res.month);
                    let data;
                    if (useRelativeAxis) {
                        data = new Array(labels.length).fill(null);
                        res.points.forEach(p => { if (p.x >= 0 && p.x < data.length) data[p.x] = p.y; });
                    } else {
                        data = res.points.map(p => p.y);
                    }

                    // --- GAP HANDLING ---
                    // If a day (other than the first) has 0 players, it's likely a data collection gap.
                    // We set these to null so Chart.js can span the gap smoothly (dot-less) via spanGaps: true.
                    for (let i = 1; i < data.length; i++) {
                        if (data[i] === 0) {
                            data[i] = null;
                        }
                    }

                    return {
                        label: res.label,
                        data: data,
                        borderColor: color.border,
                        backgroundColor: color.bg,
                        pointBackgroundColor: color.border,
                        borderWidth: 2,
                        tension: 0.3,
                        fill: true,
                        pointRadius: 3,
                        spanGaps: true
                    };
                });

                window.Home.chartInstance = new Chart(ctx, {
                    type: 'line',
                    data: { labels, datasets: chartDatasets },
                    options: getChartOptions(useRelativeAxis)
                });
            } finally {
                window.Home.setLoading('seasonChartContainer', false);
            }
        };

        window.Home.loadHistoryChart = async () => {
            try {
                window.Home.setLoading('historyChartContainer', true);

                if (!window.Home.cachedHistory) {
                    const req = await fetch(CONSTANTS.API.HISTORY_SEASONS);
                    if (!req.ok) throw new Error("History fetch failed");
                    window.Home.cachedHistory = await req.json();
                }

                const displayData = window.Home.cachedHistory.map(d => {
                    const date = new Date(d.year, d.month - 1, 1);
                    const label = `${date.toLocaleString('default', { month: 'short' })} '${date.getFullYear().toString().slice(-2)}`;
                    return { ...d, label };
                }).sort((a, b) => (a.year - b.year) || (a.month - b.month));

                const btnAvg = $('btnAvg');
                const isAvgView = btnAvg && btnAvg.classList.contains('active');

                const canvas = $('historyChart');
                if (!canvas) return;

                const ctx = canvas.getContext('2d');
                if (window.Home.historyChartInstance) window.Home.historyChartInstance.destroy();

                const dataPoints = displayData.map(d => {
                    if (isAvgView) {
                        const days = getSeasonDuration(d.year, d.month);
                        return Math.round(d.total / days);
                    }
                    return d.total;
                });

                window.Home.historyChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: displayData.map(d => d.label),
                        datasets: [{
                            label: isAvgView ? 'Infinite/Day' : 'Infinite Players',
                            data: dataPoints,
                            backgroundColor: window.SnapUtils.CHART_PALETTE[1].bg,
                            borderColor: window.SnapUtils.CHART_PALETTE[1].border,
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true,
                            pointRadius: 3,
                            pointBackgroundColor: window.SnapUtils.CHART_PALETTE[1].border
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: { duration: 1000, easing: 'easeOutQuart' },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                                mode: 'index',
                                intersect: false,
                                padding: 12,
                                cornerRadius: 8,
                                callbacks: {
                                    label: (item) => `${item.dataset.label}: ${item.raw.toLocaleString()}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: { color: 'rgba(255,255,255,0.05)' },
                                ticks: { color: '#888', font: { size: 11 } },
                                title: {
                                    display: true,
                                    text: isAvgView ? 'Infinite/Day' : 'Infinite Players',
                                    color: '#f0f0f0'
                                }
                            },
                            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', font: { size: 11 }, maxRotation: 45, minRotation: 45 }, title: { display: true, text: 'Season', color: '#f0f0f0' } }
                        }
                    }
                });
            } catch (e) {
                console.warn("[Index] Error loading history chart:", e);
            } finally {
                window.Home.setLoading('historyChartContainer', false);
            }
        };

        // --- INITIALIZATION ---
        initChartDefaults();
        initTabs();
        populateSeasonSelector();

        // Initial Loads
        window.Home.loadSeasonChart().catch(e => console.error("Season Chart Error:", e));
        window.Home.loadHistoryChart().catch(e => console.error("History Chart Error:", e));
        fetchMovers().catch(e => console.error("Movers Error:", e));

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dd = $('seasonDropdown');
            const trig = $('seasonTrigger');
            if (dd && trig && !dd.contains(e.target) && !trig.contains(e.target)) {
                dd.style.display = 'none';
            }
        });

        function populateSeasonSelector() {
            const container = $('seasonDropdown');
            if (!container) return;
            container.innerHTML = '';

            const now = new Date();
            const months = CONSTANTS.MONTHS;

            const addItem = (val, text, isDefault) => {
                const div = document.createElement('div');
                div.style.padding = '4px 0';
                div.innerHTML = `
                    <label style="display:flex; align-items:center; cursor:pointer; width:100%; margin:0;">
                        <input type="checkbox" value="${val}" class="season-check" ${isDefault ? 'checked' : ''} onchange="handleSeasonChange()">
                        <span style="font-size:0.9rem; margin-left:8px;">${text}</span>
                    </label>
                `;
                container.appendChild(div);
            };

            const activeSeason = window.SnapUtils.getCurrentSeason(now);
            addItem('current', `${months[activeSeason.month - 1]} ${activeSeason.year}`, true);

            const startYear = 2025;
            const startMonth = 9; // October
            let y = activeSeason.year;
            let m = activeSeason.month - 2;
            if (m < 0) { m = 11; y--; }

            while (y > startYear || (y === startYear && m >= startMonth)) {
                addItem(`${y}-${m + 1}`, `${months[m]} ${y}`, false);
                m--;
                if (m < 0) { m = 11; y--; }
            }
            window.Home.updateTriggerText();
        }

        // --- MOVERS ---

        async function fetchMovers() {
            const now = new Date();
            const utcHour = now.getUTCHours();
            let d1 = new Date();
            let d2 = new Date();

            if (utcHour < 19) {
                d1.setDate(d1.getDate() - 1);
                d2.setDate(d2.getDate() - 2);
            } else {
                d2.setDate(d2.getDate() - 1);
            }

            const date1 = d1.toISOString().split('T')[0];
            const date2 = d2.toISOString().split('T')[0];
            const fmt = d => d.toLocaleString('default', { month: 'short', day: 'numeric' });
            const dateRangeStr = `${fmt(d2)} → ${fmt(d1)}`;

            const dateSpanG = $('movers-date-gainers');
            const dateSpanL = $('movers-date-losers');
            if (dateSpanG) dateSpanG.innerText = dateRangeStr;
            if (dateSpanL) dateSpanL.innerText = dateRangeStr;

            $('subtitle-gainers').innerText = "24 Hour Gain";
            $('subtitle-losers').innerText = "24 Hour Drop";

            try {
                const req = await fetch(`${CONSTANTS.API.LEADERBOARD_MOVERS}?date1=${date1}&date2=${date2}`);
                if (!req.ok) {
                    $('gainers-table').querySelector('tbody').innerHTML = `<tr><td>No data available</td></tr>`;
                    $('losers-table').querySelector('tbody').innerHTML = `<tr><td>No data available</td></tr>`;
                    return;
                }
                const data = await req.json();

                const renderRows = (list, isGain) => {
                    if (!list || !list.length) return "<tr><td>No data</td></tr>";
                    return list.slice(0, 10).map((p, i) => {
                        const spContext = (p.spStart && p.spEnd)
                            ? `<span class="text-muted" style="font-size:0.8rem;">${p.spStart} → ${p.spEnd} SP</span>`
                            : '';
                        return `<tr class="card-clickable" onclick="SnapUtils.navigateTo(event, '/player/${escapeHtml(p.id)}?ref=home')">
                        <td>
                            <span class="text-muted" style="margin-right:8px; font-size:0.9em;">${i + 1}</span>
                            <a href="/player/${escapeHtml(p.id)}?ref=home" style="color:inherit; text-decoration:none;" onclick="event.stopPropagation()">${escapeHtml(p.name)}</a>
                        </td>
                        <td style="text-align:right;">
                            <div class="mover-cell-right">
                                ${spContext}
                                <span class="${isGain ? 'gainer' : 'loser'}">${isGain ? '+' : ''}${p.change}</span>
                            </div>
                        </td>
                    </tr>`;
                    }).join('');
                };
                $('gainers-table').querySelector('tbody').innerHTML = renderRows(data.topGainers, true);
                $('losers-table').querySelector('tbody').innerHTML = renderRows(data.topLosers, false);

                if (data.totalInfinitePlayers) {
                    const headerCont = $('infinite-header-container');
                    const headerVal = $('infinite-count-header');
                    if (headerCont && headerVal) {
                        headerCont.style.display = 'inline-flex';
                        animateValue(headerVal, 0, data.totalInfinitePlayers, 1500);
                    }
                }
            } catch (e) {
                console.error("Movers fetch error:", e);
            }
        }
    });

    // Make functions globally available as well
    window.loadHistoryChart = window.Home.loadHistoryChart;
})();
