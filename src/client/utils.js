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
