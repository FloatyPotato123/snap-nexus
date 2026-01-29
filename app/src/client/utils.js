/**
 * client/utils.js
 * Entry point for client-side shared logic.
 * Bundled by esbuild into dist/client-utils.js
 */
import { getSeasonStartForMonth, getSeasonEndForMonth, getSeasonStart, getSeasonEnd, getCurrentSeason } from '../utils/seasons.js';

// Global Namespace to avoid collisions with other 'utils'
window.SnapUtils = window.SnapUtils || {};

// Export Season Logic
window.SnapUtils.getSeasonStartForMonth = getSeasonStartForMonth;
window.SnapUtils.getSeasonEndForMonth = getSeasonEndForMonth;
window.SnapUtils.getSeasonStart = getSeasonStart;
window.SnapUtils.getSeasonEnd = getSeasonEnd;
window.SnapUtils.getCurrentSeason = getCurrentSeason;

// Export Helper $
window.SnapUtils.$ = (id) => document.getElementById(id);

// Export Animate Helper
window.SnapUtils.animateValue = function (obj, start, end, duration) {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        // Ease out cubic
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(easeProgress * (end - start) + start);
        obj.innerHTML = current.toLocaleString();
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
};

// Unified Navigation Helper (respects Command/Ctrl click for new tabs)
window.SnapUtils.navigateTo = function (event, url) {
    if (event.metaKey || event.ctrlKey) {
        window.open(url, '_blank');
    } else {
        window.location.href = url;
    }
};

// --- CHART.JS HELPERS ---

// Palette (12 Colors)
window.SnapUtils.CHART_PALETTE = [
    { border: '#fbbf24', bg: 'rgba(251, 191, 36, 0.1)' }, // Amber (Current/Gold)
    { border: '#60a5fa', bg: 'rgba(96, 165, 250, 0.1)' }, // Blue
    { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.1)' }, // Purple
    { border: '#f87171', bg: 'rgba(248, 113, 113, 0.1)' }, // Red
    { border: '#4ade80', bg: 'rgba(74, 222, 128, 0.1)' }, // Green
    { border: '#22d3ee', bg: 'rgba(34, 211, 238, 0.1)' }, // Cyan
    { border: '#fb923c', bg: 'rgba(251, 146, 60, 0.1)' }, // Orange
    { border: '#f472b6', bg: 'rgba(244, 114, 182, 0.1)' }, // Pink
    { border: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.1)' }, // Teal
    { border: '#818cf8', bg: 'rgba(129, 140, 248, 0.1)' }, // Indigo
    { border: '#a3e635', bg: 'rgba(163, 230, 53, 0.1)' }, // Lime
    { border: '#e879f9', bg: 'rgba(232, 121, 249, 0.1)' }  // Magenta
];

window.SnapUtils.initChartDefaults = function () {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
    Chart.defaults.color = '#aaa';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.1)';
};

window.SnapUtils.getSeasonColor = function (year, month) {
    const now = new Date();
    const active = SnapUtils.getCurrentSeason(now);
    const diffYears = active.year - year;
    const diffMonths = active.month - month;
    const totalMonthDiff = (diffYears * 12) + diffMonths;

    // We want 0-diff (current) to be index 0 (Amber)
    const index = Math.abs(totalMonthDiff) % window.SnapUtils.CHART_PALETTE.length;
    return window.SnapUtils.CHART_PALETTE[index];
};
