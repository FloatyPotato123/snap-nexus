/**
 * client/home.js
 * Logic for the Home Dashboard (index.html).
 */
(function () {
    // Wait for DOM and Dependencies
    window.addEventListener('DOMContentLoaded', async () => {
        if (typeof SnapUtils === 'undefined' || typeof Chart === 'undefined') {
            console.error("Missing dependencies: SnapUtils or Chart.js");
            return;
        }

        const $ = SnapUtils.$;
        let chartInstance = null;
        let historyChartInstance = null;
        let cachedHistory = null;

        // --- UTILS ---

        SnapUtils.initChartDefaults();
        populateSeasonSelector();

        // Run independently (parallel) to prevent blocking
        loadSeasonChart().catch(e => console.error("Season Chart Error:", e));
        loadHistoryChart().catch(e => console.error("History Chart Error:", e));
        fetchMovers().catch(e => console.error("Movers Error:", e));

        window.toggleSeasonDropdown = function () {

            const dd = $('seasonDropdown');
            const isOpen = dd.style.display === 'block';
            dd.style.display = isOpen ? 'none' : 'block';
        }

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
            const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

            // Helper to add checkbox item
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

            // Current Season
            const activeSeason = SnapUtils.getCurrentSeason(now);
            const seasonY = activeSeason.year;
            const seasonM = activeSeason.month - 1;

            addItem('current', `${months[seasonM]} ${seasonY}`, true);

            // Past Seasons
            const startYear = 2025;
            const startMonth = 9; // October index
            let y = seasonY;
            let m = seasonM - 1;
            if (m < 0) { m = 11; y--; }

            while (y > startYear || (y === startYear && m >= startMonth)) {
                if (y !== seasonY || m !== seasonM) {
                    addItem(`${y}-${m + 1}`, `${months[m]} ${y}`, false);
                }
                m--;
                if (m < 0) { m = 11; y--; }
            }

            updateTriggerText();
        }

        window.handleSeasonChange = function () {
            updateTriggerText();
            loadSeasonChart();
        }

        function updateTriggerText() {
            const checked = document.querySelectorAll('.season-check:checked');
            const btnText = $('seasonTriggerText');
            if (!btnText) return;

            if (checked.length === 0) {
                btnText.innerText = 'Select Season...';
            } else if (checked.length === 1) {
                // Find visible text
                const label = checked[0].nextElementSibling.innerText;
                btnText.innerText = label;
            } else {
                btnText.innerText = `Comparing ${checked.length} Seasons`;
            }
        }

        // --- CHART 1: MULTI-SEASON ---
        // --- CONFIGURATION ---


        function getChartOptions(useRelativeAxis) {
            return {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: useRelativeAxis, labels: { color: '#f0f0f0' } },
                    tooltip: {
                        callbacks: {
                            title: (items) => useRelativeAxis ? `Day ${items[0].dataIndex + 1}` : items[0].label
                        }
                    }
                },
                scales: {
                    y: {
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#f0f0f0' },
                        title: { display: true, text: 'Players', color: '#f0f0f0' }
                    },
                    x: {
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#f0f0f0' },
                        title: { display: true, text: useRelativeAxis ? 'Day of Season' : 'Date (M/D)', color: '#f0f0f0' }
                    }
                }
            };
        }

        async function fetchSeasonData(season, now) {
            let year, month;
            if (!season.val || season.val === 'current') {
                const active = SnapUtils.getCurrentSeason(now);
                year = active.year;
                month = active.month;
            } else {
                [year, month] = season.val.split('-').map(Number);
            }

            const start = SnapUtils.getSeasonStartForMonth(year, month - 1);
            start.setDate(start.getDate() + 1); // Skip Day 1
            const end = SnapUtils.getSeasonEndForMonth(year, month - 1);

            // Cap at today for current season
            let fetchEnd = end;
            const active = SnapUtils.getCurrentSeason(now);
            if (year === active.year && month === active.month) {
                fetchEnd = now;
            }

            const sStr = start.toISOString().split('T')[0];
            const eStr = fetchEnd.toISOString().split('T')[0];

            try {
                const req = await fetch(`/api/season/stats?start=${sStr}&end=${eStr}`);
                const data = await req.json();
                return { ...season, data, year, month, start };
            } catch {
                return null;
            }
        }

        // --- CHART 1: MULTI-SEASON ---
        async function loadSeasonChart(seasonVal) {
            seasonVal = seasonVal || ($('seasonSelector') ? $('seasonSelector').value : 'current');

            // Collect selected seasons
            const checkboxes = Array.from(document.querySelectorAll('.season-check:checked'));
            let seasonsToFetch = checkboxes.map(cb => ({
                val: cb.value,
                label: cb.nextElementSibling.innerText.split(' (')[0] // Clean label
            }));

            // Fallback if triggered directly with a value but logic above missed it
            if (seasonsToFetch.length === 0 && seasonVal && seasonVal !== 'current') {
                seasonsToFetch = [{ val: seasonVal, label: 'Selected Season' }]; // Fallback label
            }
            // Fallback to current


            const useRelativeAxis = seasonsToFetch.length > 1;
            const now = new Date();

            const results = (await Promise.all(
                seasonsToFetch.map(s => fetchSeasonData(s, now))
            )).filter(r => r && r.data && r.data.length > 0);

            if (results.length === 0) {
                if (chartInstance) chartInstance.destroy();
                $('seasonChart').style.display = 'none';
                $('noSeasonData').style.display = 'block';
                $('noSeasonData').innerText = 'Select a season to view data';
                return;
            }

            $('seasonChart').style.display = 'block';
            $('noSeasonData').style.display = 'none';
            $('seasonChartContainer').style.height = '350px';

            const ctx = $('seasonChart').getContext('2d');
            if (chartInstance) chartInstance.destroy();

            // 1. Process Data Points
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

            // 2. Generate Labels
            let labels;
            if (useRelativeAxis) {
                let maxDay = 0;
                processedDatasets.forEach(d => d.points.forEach(p => maxDay = Math.max(maxDay, p.x)));
                maxDay = Math.max(maxDay, 28);
                labels = Array.from({ length: maxDay + 1 }, (_, i) => `Day ${i + 1}`);
            } else {
                labels = processedDatasets[0].points.map(p => p.x);
            }

            // 3. Create Chart Datasets

            const chartDatasets = processedDatasets.map((res) => {
                // Calculate month difference for consistent coloring based on recency
                // Current Season (0 diff) = Gold
                const color = SnapUtils.getSeasonColor(res.year, res.month);
                const isPrimary = res.val === 'current';

                let data;
                if (useRelativeAxis) {
                    data = new Array(labels.length).fill(null);
                    res.points.forEach(p => {
                        if (p.x >= 0 && p.x < data.length && p.y > 0) data[p.x] = p.y;
                    });
                } else {
                    data = res.points.map(p => (p.y > 0 ? p.y : null));
                }

                return {
                    label: res.label,
                    data: data,
                    borderColor: color.border,
                    backgroundColor: color.bg.replace('0.2)', '0.1)'), // Restore lighter opacity
                    pointBackgroundColor: color.point || color.border,
                    borderWidth: 2, // Revert to thinner lines
                    tension: 0.3,
                    fill: true,
                    pointRadius: 3,
                    borderDash: [],
                    hitRadius: 10,
                    spanGaps: true
                };
            });

            chartInstance = new Chart(ctx, {
                type: 'line',
                data: { labels, datasets: chartDatasets },
                options: getChartOptions(useRelativeAxis)
            });
        }

        // --- CHART 2: HISTORY (BLUE) ---


        async function loadHistoryChart() {
            try {
                if (!cachedHistory) {
                    // 1. Fetch Legacy Data
                    // 1. Fetch Legacy Data
                    const legacyReq = await fetch('/api/history/legacy');
                    if (!legacyReq.ok) throw new Error("Legacy history fetch failed");
                    const legacyData = await legacyReq.json();

                    // 2. Determine Missing Seasons (Dec 2025 onwards)
                    const dynamicData = [];
                    const now = new Date();

                    // Start checking from Dec 2025 (Month 11)
                    // We only want COMPLETED seasons.
                    let checkY = 2025;
                    let checkM = 11; // 0-indexed Dec

                    while (true) {
                        // Calculate Season End for this month
                        const seasonEnd = SnapUtils.getSeasonEndForMonth(checkY, checkM);

                        // If season hasn't ended yet, stop  

                        const graceTime = new Date(seasonEnd);
                        graceTime.setUTCHours(19);

                        if (graceTime > now) break;

                        // If it's a valid past season, fetch its end-date data
                        const dateStr = seasonEnd.toISOString().split('T')[0];
                        try {
                            // Use range with same start/end to get that specific day's total efficiently
                            const r = await fetch(`/api/season/stats?start=${dateStr}&end=${dateStr}`);
                            if (r.ok) {
                                const json = await r.json();
                                if (json && json.length > 0 && json[0].total) {
                                    const monthName = seasonEnd.toLocaleString('default', { month: 'long' });
                                    dynamicData.push({
                                        label: monthName,
                                        total: json[0].total,
                                        month: checkM + 1,
                                        year: checkY
                                    });
                                }
                            }
                        } catch (e) {
                        }

                        // Increment
                        checkM++;
                        if (checkM > 11) { checkM = 0; checkY++; }
                    }

                    cachedHistory = [...legacyData, ...dynamicData];
                }

                // Standardize Labels: "Jan '25"
                cachedHistory = cachedHistory.map(d => {
                    const date = new Date(d.year, d.month - 1, 1);
                    const shortMonth = date.toLocaleString('default', { month: 'short' });
                    const shortYear = date.getFullYear().toString().slice(-2); // Use getFullYear for consistency
                    return { ...d, label: `${shortMonth} '${shortYear}` };
                });

                // Sort chronologically
                cachedHistory.sort((a, b) => {
                    if (a.year !== b.year) return a.year - b.year;
                    return a.month - b.month;
                });

                const ctx = $('historyChart').getContext('2d');
                if (historyChartInstance) historyChartInstance.destroy();

                historyChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: cachedHistory.map(d => d.label),
                        datasets: [{
                            label: 'Infinite Players',
                            data: cachedHistory.map(d => d.total),
                            backgroundColor: SnapUtils.CHART_PALETTE[1].bg, // BLUE
                            borderColor: SnapUtils.CHART_PALETTE[1].border, // BLUE
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true,
                            pointRadius: 3,
                            pointBackgroundColor: SnapUtils.CHART_PALETTE[1].border
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
                        scales: {
                            y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#f0f0f0' }, title: { display: true, text: 'Players', color: '#f0f0f0' } },
                            x: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#f0f0f0', maxRotation: 45, minRotation: 45 }, title: { display: true, text: 'Season', color: '#f0f0f0' } }
                        }
                    }
                });
            } catch (e) {
                console.warn("[Index] Error loading history chart:", e);
            }
        }

        // --- MOVERS ---
        async function fetchMovers() {
            // Logic: Scraper runs at 19:00 UTC.
            // If current UTC time < 19:00, "Today's" scrape hasn't happened yet.
            // So we show Yesterday vs Day Before.
            // If >= 19:00, we show Today vs Yesterday.

            const now = new Date();
            const utcHour = now.getUTCHours();

            let d1 = new Date();
            let d2 = new Date();

            if (utcHour < 19) {
                // Scrape pending for today. Show Yesterday vs Day Before.
                d1.setDate(d1.getDate() - 1);
                d2.setDate(d2.getDate() - 2);
            } else {
                // Scrape done for today. Show Today vs Yesterday.
                d2.setDate(d2.getDate() - 1);
            }

            const date1 = d1.toISOString().split('T')[0];
            const date2 = d2.toISOString().split('T')[0];

            // Static subtitles as requested
            $('subtitle-gainers').innerText = "24 Hour Gain";
            $('subtitle-losers').innerText = "24 Hour Drop";

            try {
                // Note: Updated to use /api prefix
                const req = await fetch(`/api/leaderboard/movers?date1=${date1}&date2=${date2}`);
                if (!req.ok) {
                    const err = await req.json();
                    $('gainers-table').querySelector('tbody').innerHTML = `<tr><td>No data available (${req.status})</td></tr>`;
                    $('losers-table').querySelector('tbody').innerHTML = `<tr><td>No data available (${req.status})</td></tr>`;
                    return;
                }
                const data = await req.json();
                const renderRows = (list, isGain) => {
                    if (!list || !list.length) return "<tr><td>No data</td></tr>";
                    return list.slice(0, 10).map(p => {
                        const spContext = (p.spStart && p.spEnd)
                            ? `<span class="text-muted" style="font-size:0.8rem; margin-right:1rem;">${p.spStart} → ${p.spEnd} SP</span>`
                            : '';
                        return `<tr class="card-clickable" onclick="SnapUtils.navigateTo(event, '/player/${p.id}?ref=home')">
                        <td><a href="/player/${p.id}?ref=home" style="color:inherit; text-decoration:none;" onclick="event.stopPropagation()">${p.name}</a></td>
                        <td style="text-align:right;">
                            ${spContext}
                            <span class="${isGain ? 'gainer' : 'loser'}">${isGain ? '+' : ''}${p.change}</span>
                        </td>
                    </tr>`;
                    }).join('');
                };
                $('gainers-table').querySelector('tbody').innerHTML = renderRows(data.topGainers, true);
                $('losers-table').querySelector('tbody').innerHTML = renderRows(data.topLosers, false);


                // Update Infinite Count
                if (data.totalInfinitePlayers) {
                    const count = data.totalInfinitePlayers;

                    // Infinite Players Badge
                    const headerCont = document.getElementById('infinite-header-container');
                    const headerVal = document.getElementById('infinite-count-header');
                    if (headerCont && headerVal) {
                        headerCont.style.display = 'inline-flex';
                        SnapUtils.animateValue(headerVal, 0, count, 1500);
                    }
                }

            } catch (e) {
                $('gainers-table').querySelector('tbody').innerHTML = `<tr><td>Error loading data</td></tr>`;
                $('losers-table').querySelector('tbody').innerHTML = `<tr><td>Error loading data</td></tr>`;
                console.error(e);
            }
        }
    });
})();
