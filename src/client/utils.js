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
