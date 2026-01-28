/**
 * client/profile.js
 * Logic for the Player Profile page.
 */
(function () {
    const $ = SnapUtils.$;
    const pathParts = window.location.pathname.split('/');
    const playerId = pathParts[pathParts.length - 1];

    // Initialize Chart Defaults
    SnapUtils.initChartDefaults();

    // Chart Instances
    let seasonChartInstance = null;
    let historicalChartInstance = null;

    function populateSeasonSelector() {
        const select = $('seasonSelect');
        const now = new Date();
        const startYear = 2025;
        const startMonth = 9; // October index (0-11)

        // Loop from current date down to Nov 2025
        let y = now.getFullYear();
        let m = now.getMonth();

        // Marvel Snap Season Logic: Starts first Tuesday
        const activeSeason = SnapUtils.getCurrentSeason(now);
        y = activeSeason.year;
        m = activeSeason.month - 1; // 0-indexed for loop

        // Loop backwards to startYear
        while (y > startYear || (y === startYear && m >= startMonth)) {

            const opt = document.createElement('option');
            opt.value = `${y}-${m + 1}`; // 2026-1 for Jan
            const monthName = new Date(y, m).toLocaleString('default', { month: 'long' });
            opt.text = `${monthName} ${y}`;
            select.appendChild(opt);

            m--;
            if (m < 0) { m = 11; y--; }
        }

        // Handle loading new data on change
        select.addEventListener('change', async () => {
            const [year, month] = select.value.split('-');
            await loadSeasonData(year, month);
        });
    }

    async function loadSeasonData(year, month) {
        try {
            // If loading specific season, re-fetch profile with params
            // Note: This fetches everything again, but allows us to reuse the robust API logic
            const req = await fetch(`/api/player/${playerId}?month=${month}&year=${year}`);
            if (!req.ok) throw new Error("Failed to load season");
            const data = await req.json();

            if (data.currentSeasonStats && data.currentSeasonStats.length > 0) {
                $('seasonChart').style.display = 'block';
                $('noSeasonStats').style.display = 'none';
                $('seasonChartContainer').style.height = '350px';
                renderSeasonChart(data.currentSeasonStats);
            } else {
                $('seasonChart').style.display = 'none';
                $('noSeasonStats').style.display = 'block';
                $('seasonChartContainer').style.height = 'auto'; // Collapse
            }
        } catch (e) {
            console.warn("[Profile] Error loading season data:", e);
        }
    }

    async function loadProfile() {
        try {
            populateSeasonSelector();

            const req = await fetch(`/api/player/${playerId}`);
            if (!req.ok) throw new Error("Player not found");
            const data = await req.json();

            $('pName').innerText = data.name;
            $('pId').innerText = data.id;

            // Current Rank & SP
            if (data.currentRank) {
                $('pRank').innerText = data.currentRank;
                $('pRank').dataset.rank = data.currentRank;

                if (data.currentSP) {
                    $('pRank').dataset.sp = data.currentSP;
                    $('pSP').innerText = parseInt(data.currentSP).toLocaleString();
                    $('pSPBadge').style.display = 'inline-block';
                }

                $('pRankBadge').style.display = 'inline-block';
            } else {
                $('pRankBadge').style.display = 'none';
                $('pRank').dataset.sp = '';
                $('pRank').dataset.rank = '';
            }

            $('pName').innerText = data.name;
            $('pName').dataset.rawName = data.name;
            document.title = `${data.name} | Snap Nexus`;

            // History Timeline
            let timelineHtml = '';
            // Sort history desc (newest first) explicitly
            const historyList = (data.history || []).sort((a, b) => new Date(b.seenAt) - new Date(a.seenAt));

            historyList.forEach((h, index) => {
                const isCurrent = index === 0;
                const isOldest = index === historyList.length - 1;
                const dateClass = isCurrent ? 'timeline-date' : 'timeline-date';
                const dotClass = isCurrent ? '' : 'past';
                const label = isOldest ? '' : h.seenAt;

                timelineHtml += `
                        <div class="timeline-item ${dotClass}">
                            <div class="timeline-name">${h.name}</div>
                            <div class="${dateClass}">${label}</div>
                        </div>
                    `;
            });
            $('historyTimeline').innerHTML = timelineHtml || '<div class="status-msg">No history found</div>';

            // Charts & Stats
            if (data.currentSeasonStats && data.currentSeasonStats.length > 0) {
                $('seasonChart').style.display = 'block';
                $('noSeasonStats').style.display = 'none';
                $('seasonChartContainer').style.height = '350px';
                renderSeasonChart(data.currentSeasonStats);
            } else {
                $('seasonChart').style.display = 'none';
                $('noSeasonStats').style.display = 'block';
                $('seasonChartContainer').style.height = 'auto'; // Collapse
            }

            if (data.historicalSeasonRanks && data.historicalSeasonRanks.length > 0) {
                $('historicalChart').style.display = 'block';
                $('noHistoricalStats').style.display = 'none';
                $('historicalChartContainer').style.height = '350px';
                renderHistoricalChart(data.historicalSeasonRanks);
            } else {
                $('historicalChart').style.display = 'none';
                $('noHistoricalStats').style.display = 'block';
                $('historicalChartContainer').style.height = 'auto'; // Collapse
            }

            $('loading').style.display = 'none';
            $('content').style.display = 'block';
        } catch (e) {
            $('loading').innerHTML = `<div class="error-msg">Error: ${e.message}</div>`;
            console.error(e);
        }
    }

    function renderSeasonChart(stats) {
        const ctx = $('seasonChart').getContext('2d');
        if (seasonChartInstance) seasonChartInstance.destroy();

        // Calc SP Range
        const spValues = stats.map(s => s.sp).filter(v => v > 0);
        let minSP = undefined;
        let maxSP = undefined;
        if (spValues.length > 0) {
            let dMin = Math.min(...spValues);
            let dMax = Math.max(...spValues);
            if ((dMax - dMin) < 1000) {
                const mid = (dMax + dMin) / 2;
                minSP = mid - 500;
                maxSP = mid + 500;
            }
        }

        seasonChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: stats.map(s => {
                    const d = new Date(s.date);
                    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
                }),
                datasets: [
                    {
                        label: 'Rank',
                        data: stats.map(s => s.rank),
                        borderColor: '#2196F3', // Blue
                        backgroundColor: 'rgba(33, 150, 243, 0)', // Transparent
                        yAxisID: 'y',
                        tension: 0.2,
                        fill: false,
                        borderDash: [5, 5]
                    },
                    {
                        label: 'SP',
                        data: stats.map(s => s.sp),
                        borderColor: '#ffcc00', // Gold
                        backgroundColor: 'rgba(255, 204, 0, 0.1)', // Gold Fill
                        yAxisID: 'y1',
                        tension: 0.2,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { grid: { color: '#333' }, ticks: { color: '#aaa' } },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        reverse: true, // Rank 1 top
                        min: 1,
                        suggestedMax: 100,
                        title: { display: true, text: 'Rank', color: '#2196F3' },
                        grid: { color: '#333' },
                        ticks: { color: '#2196F3' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'Snap Points', color: '#ffcc00' },
                        suggestedMin: minSP,
                        suggestedMax: maxSP,
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#ffcc00' }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#fff' } }
                }
            }
        });
        // 6. Attach raw stats for image generation
        seasonChartInstance.rawStats = stats;
    }

    function renderHistoricalChart(stats) {
        const ctx = $('historicalChart').getContext('2d');
        if (historicalChartInstance) historicalChartInstance.destroy();

        // Calc SP Range
        const spValues = stats.map(s => s.sp).filter(v => v > 0);
        let minSP = undefined;
        let maxSP = undefined;
        if (spValues.length > 0) {
            let dMin = Math.min(...spValues);
            let dMax = Math.max(...spValues);
            if ((dMax - dMin) < 1000) {
                const mid = (dMax + dMin) / 2;
                minSP = mid - 500;
                maxSP = mid + 500;
            }
        }

        historicalChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: stats.map(s => s.season),
                datasets: [
                    {
                        label: 'Season End Rank',
                        data: stats.map(s => s.rank),
                        borderColor: '#2196F3', // Blue (Rank)
                        backgroundColor: 'rgba(33, 150, 243, 0)',
                        yAxisID: 'y',
                        tension: 0.2,
                        fill: false,
                        borderDash: [5, 5]
                    },
                    {
                        label: 'Season End SP',
                        data: stats.map(s => s.sp),
                        borderColor: '#ffcc00', // Gold (SP)
                        backgroundColor: 'rgba(255, 204, 0, 0.1)',
                        yAxisID: 'y1',
                        tension: 0.2,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { grid: { color: '#333' }, ticks: { color: '#aaa' } },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        reverse: true, // Rank 1 top
                        min: 1, // Always show "Best" as 1
                        suggestedMax: 100,
                        title: { display: true, text: 'Rank', color: '#2196F3' },
                        grid: { color: '#333' },
                        ticks: { color: '#2196F3' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'Snap Points', color: '#ffcc00' },
                        suggestedMin: minSP,
                        suggestedMax: maxSP,
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#ffcc00' }
                    }
                }
            }
        });
    }

    // Exported for onclick handler
    window.copySeasonGraphImage = function () {
        const btn = $('shareSeasonGraphBtn');
        const originalText = btn.innerText;
        btn.innerText = "Generating...";
        btn.setAttribute('aria-busy', 'true');

        // We wrap the entire generation in the ClipboardItem Promise
        const blobPromise = new Promise(async (resolve, reject) => {
            try {
                // Check if chart exists
                if (!seasonChartInstance) throw new Error("No chart to copy");

                // 1. Calculate Rank/SP Data FIRST to determine layout
                let rankText = null;
                let spText = null;

                const selectedVal = $('seasonSelect').value;
                if (selectedVal) {
                    const [yearStr, monthStr] = selectedVal.split('-');
                    const sYear = parseInt(yearStr);
                    const sMonth0 = parseInt(monthStr) - 1;

                    const now = new Date();
                    const active = SnapUtils.getCurrentSeason(now);
                    const activeKey = `${active.year}-${active.month}`;
                    const isCurrentSeason = selectedVal === activeKey;

                    const rawStats = seasonChartInstance.rawStats || [];

                    // 1. Current Season Live Data
                    if (isCurrentSeason) {
                        const pRankBadge = $('pRankBadge');
                        if (pRankBadge && pRankBadge.style.display !== 'none') {
                            rankText = "Rank " + $('pRank').dataset.rank;
                            const liveSP = $('pRank').dataset.sp;
                            spText = liveSP ? `${parseInt(liveSP).toLocaleString()} SP` : null;
                        }
                    }
                    // 2. Past Season Historical Data
                    else if (rawStats.length > 0) {
                        const lastEntry = rawStats[rawStats.length - 1];
                        const lastRank = lastEntry.rank;
                        const lastSP = lastEntry.sp;

                        const seasonEndDate = SnapUtils.getSeasonEndForMonth(sYear, sMonth0);
                        const seasonEndStr = seasonEndDate.toISOString().split('T')[0];

                        // Also allow the day before (Monday) in case the Tuesday snapshot is missing/empty
                        const prevDate = new Date(seasonEndDate);
                        prevDate.setUTCDate(prevDate.getUTCDate() - 1);
                        const prevDateStr = prevDate.toISOString().split('T')[0];

                        // Check: Data is from Season End OR Day Before
                        if ((lastEntry.date === seasonEndStr || lastEntry.date === prevDateStr) && lastRank) {
                            rankText = "Rank " + lastRank;
                            spText = lastSP ? `${lastSP.toLocaleString()} SP` : null;
                        }
                    }
                }

                // 2. Setup Layout
                const layoutScale = 1.0;
                const width = 1200 * layoutScale;
                const height = 675 * layoutScale;
                const padding = 30 * layoutScale;
                const headerHeight = (rankText ? 160 : 120) * layoutScale;

                // 3. Setup Export Canvas (High-DPI)
                const dpi = 2; // "Retina" resolution for standard high-quality share image
                const highResWidth = width * dpi;
                const highResHeight = height * dpi;
                const highResPadding = padding * dpi;
                const highResHeaderHeight = headerHeight * dpi;

                const canvas = document.createElement('canvas');
                canvas.width = highResWidth;
                canvas.height = highResHeight;
                const ctx = canvas.getContext('2d');

                // Quality settings
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';

                // 4. Background
                ctx.fillStyle = '#1e293b'; // Slate 800
                ctx.fillRect(0, 0, highResWidth, highResHeight);

                // 5. Render High-Res Chart (Off-screen)
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = highResWidth - (highResPadding * 2);
                tempCanvas.height = highResHeight - highResHeaderHeight - highResPadding;
                const tempCtx = tempCanvas.getContext('2d');

                // Clone Config & Scale Fonts
                const originalConfig = seasonChartInstance.config;
                const newOptions = JSON.parse(JSON.stringify(originalConfig.options));

                newOptions.animation = false;
                newOptions.responsive = false;
                newOptions.maintainAspectRatio = false;
                newOptions.devicePixelRatio = dpi;

                // Helper to safely set font size and padding
                const setFont = (obj, size) => {
                    if (!obj.font) obj.font = {};
                    obj.font.size = size * dpi;
                    obj.font.family = "'Inter', system-ui, sans-serif";
                };

                const adjustAxis = (axis, fontSize, titleSize) => {
                    if (!axis) return;
                    if (!axis.ticks) axis.ticks = {};
                    setFont(axis.ticks, fontSize);
                    axis.ticks.padding = 10 * dpi;

                    if (!axis.title) axis.title = {};
                    setFont(axis.title, titleSize);
                    axis.title.padding = { top: 10 * dpi, bottom: 0 };
                };

                adjustAxis(newOptions.scales.x, 14, 16);
                adjustAxis(newOptions.scales.y, 14, 16);
                adjustAxis(newOptions.scales.y1, 14, 16);

                // Scale Legend
                if (newOptions.plugins && newOptions.plugins.legend && newOptions.plugins.legend.labels) {
                    setFont(newOptions.plugins.legend.labels, 14);
                    newOptions.plugins.legend.labels.boxWidth = 40 * dpi;
                    newOptions.plugins.legend.labels.padding = 20 * dpi;
                }

                // Add global chart padding
                if (!newOptions.layout) newOptions.layout = {};
                newOptions.layout.padding = 15 * dpi;

                // Clone Data to adjust line thickness
                const newData = JSON.parse(JSON.stringify(originalConfig.data));
                newData.datasets.forEach(ds => {
                    // Set line thickness (default is 3, using 3.5 for clarity in high-res)
                    ds.borderWidth = 3.5 * dpi;
                    if (ds.borderDash) {
                        ds.borderDash = ds.borderDash.map(v => v * dpi);
                    }
                });

                // Create Temp Chart
                const tempChart = new Chart(tempCtx, {
                    type: 'line',
                    data: newData,
                    options: newOptions
                });

                // Wait for render
                await new Promise(r => setTimeout(r, 50));

                // Draw the high‑DPI temp chart onto the main high‑DPI canvas
                ctx.drawImage(
                    tempCanvas,
                    0, 0, tempCanvas.width, tempCanvas.height,
                    highResPadding, highResHeaderHeight,
                    highResWidth - (highResPadding * 2),
                    highResHeight - highResHeaderHeight - highResPadding
                );

                // Clean up
                tempChart.destroy();
                tempCanvas.remove();

                // 6. Draw Custom Header Text
                const rawName = $('pName').dataset.rawName || $('pName').innerText.replace('Loading Profile...', '').trim();
                const seasonName = $('seasonSelect').options[$('seasonSelect').selectedIndex].text;

                ctx.textBaseline = 'top';

                // Name
                ctx.fillStyle = '#f8fafc';
                ctx.font = `bold ${48 * dpi}px system-ui, -apple-system, sans-serif`;
                ctx.textAlign = 'left';
                ctx.fillText(rawName, highResPadding, highResPadding + (15 * dpi));

                // Season (Right)
                ctx.fillStyle = '#94a3b8';
                ctx.font = `${30 * dpi}px system-ui, -apple-system, sans-serif`;
                ctx.textAlign = 'right';
                ctx.fillText(seasonName, highResWidth - highResPadding, highResPadding + (25 * dpi));

                // Rank & SP (Below Name, if exists)
                if (rankText) {
                    ctx.textAlign = 'left';
                    const rankY = highResPadding + (75 * dpi);

                    ctx.fillStyle = '#2196F3'; // Blue
                    ctx.font = `bold ${32 * dpi}px system-ui, -apple-system, sans-serif`;
                    ctx.fillText(rankText, highResPadding, rankY);

                    if (spText) {
                        const rankWidth = ctx.measureText(rankText).width;
                        ctx.fillStyle = '#ffcc00'; // Gold
                        ctx.font = `bold ${32 * dpi}px system-ui, -apple-system, sans-serif`;
                        ctx.fillText(spText, highResPadding + rankWidth + (25 * dpi), rankY);
                    }
                }

                // 7. Finalize Blob
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("Blob failed"));
                }, 'image/png');

            } catch (e) {
                reject(e);
            }
        });

        // Trigger Copy
        navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blobPromise })
        ]).then(() => {
            btn.removeAttribute('aria-busy');
            btn.innerText = "✓ Copied";
            setTimeout(() => btn.innerText = originalText, 2500);
        }).catch((err) => {
            console.error("Clipboard write failed:", err);
            btn.removeAttribute('aria-busy');
            btn.innerText = "✕ Failed";
            alert("Could not copy: " + (err.name === 'NotAllowedError' ? 'Clipboard permission denied.' : (err.message || err)));
            setTimeout(() => btn.innerText = originalText, 2500);
        });
    };

    // Load Data
    loadProfile();
})();
