/**
 * client/utils.js
 * Entry point for client-side shared logic.
 * Bundled by esbuild into dist/client-utils.js
 */
import { getSeasonStartForMonth, getSeasonEndForMonth, getSeasonStart, getSeasonEnd, getCurrentSeason } from '../utils/seasons.js';

// Global Namespace to avoid collisions with other 'utils'
window.SnapUtils = window.SnapUtils || {};

// ============================================================================
// Client-Side Constants
// ============================================================================

/**
 * Centralized configuration for client-side behavior
 */
window.SnapUtils.CONSTANTS = {
    // Timing (milliseconds)
    SEARCH_DEBOUNCE_MS: 250,
    COPY_SUCCESS_DURATION_MS: 2500,

    // Validation
    MIN_SEARCH_QUERY_LENGTH: 3,
    SEARCH_RESULTS_LIMIT: 20,

    // Data ranges
    DATA_START_YEAR: 2025,
    DATA_START_MONTH: 9, // October (0-indexed)
    MONTHS: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],

    // API Endpoints
    API: {
        PLAYER_SEARCH: '/api/players/search',
        PLAYER_PROFILE: '/api/player',
        SEASON_STATS: '/api/season/stats',
        HISTORY_SEASONS: '/api/history/seasons',
        LEADERBOARD_MOVERS: '/api/leaderboard/movers',
        LEADERBOARD_LIVE: '/api/leaderboard/live'
    },

    // UI Messages
    MESSAGES: {
        SEARCH_MIN_CHARS: 'Type at least 3 characters...',
        NO_RESULTS: 'No players found',
        SEARCHING: 'Searching...',
        LOADING: 'Loading...'
    },

    // Chart config
    CHART_HEIGHT: '350px'
};

// ============================================================================
// XSS Protection & HTML Sanitization
// ============================================================================

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * 
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for HTML insertion
 */
window.SnapUtils.escapeHtml = function (str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};

/**
 * Sanitizes player names for safe display.
 * 
 * @param {string} name - Player name to sanitize
 * @returns {string} Sanitized name
 */
window.SnapUtils.sanitizePlayerName = function (name) {
    if (typeof name !== 'string') return '';
    return name
        .replace(/[<>'"]/g, '')
        .trim()
        .substring(0, 100);
};

/**
 * Creates a safe HTML string with highlighted search terms.
 * Escapes the text first, then wraps matching portions in <strong> tags.
 * 
 * @param {string} text - Text to highlight
 * @param {string} query - Search query to highlight
 * @returns {string} HTML string with highlighted matches
 */
window.SnapUtils.highlightText = function (text, query) {
    if (!query || !text) return window.SnapUtils.escapeHtml(text);

    const escapedText = window.SnapUtils.escapeHtml(text);
    const escapedQuery = window.SnapUtils.escapeHtml(query);

    // Escape regex special characters
    const regexSafeQuery = escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${regexSafeQuery})`, 'gi');

    return escapedText.replace(regex, '<strong>$1</strong>');
};

// ============================================================================
// Season Logic
// ============================================================================

window.SnapUtils.getSeasonStartForMonth = getSeasonStartForMonth;
window.SnapUtils.getSeasonEndForMonth = getSeasonEndForMonth;
window.SnapUtils.getSeasonStart = getSeasonStart;
window.SnapUtils.getSeasonEnd = getSeasonEnd;
window.SnapUtils.getCurrentSeason = getCurrentSeason;

// ============================================================================
// DOM Helpers
// ============================================================================

/**
 * Shorthand for document.getElementById
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
window.SnapUtils.$ = (id) => document.getElementById(id);

/**
 * Animate a number value with easing
 * @param {HTMLElement} obj - Element to update
 * @param {number} start - Starting value
 * @param {number} end - Ending value
 * @param {number} duration - Animation duration in ms
 */
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

/**
 * Unified navigation helper (respects Command/Ctrl click for new tabs)
 * @param {Event} event - Click event
 * @param {string} url - URL to navigate to
 */
window.SnapUtils.navigateTo = function (event, url) {
    if (event.metaKey || event.ctrlKey) {
        window.open(url, '_blank');
    } else {
        window.location.href = url;
    }
};

// ============================================================================
// Chart.js Helpers
// ============================================================================

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

/**
 * Initialize Chart.js defaults
 */
window.SnapUtils.initChartDefaults = function () {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
    Chart.defaults.color = '#aaa';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.1)';
};

/**
 * Get color for a specific season
 * @param {number} year - Season year
 * @param {number} month - Season month
 * @returns {Object} Color object with border and bg properties
 */
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

// ============================================================================
// Tab Logic
// ============================================================================

/**
 * Initialize tab switching logic
 * Usage: Button must have class 'tab-btn' and 'data-target="someId"'
 * Target Content must have id="someId" and class 'tab-content'
 */
window.SnapUtils.initTabs = function () {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const tabBtn = e.currentTarget;
            const targetId = tabBtn.dataset.target;
            const container = tabBtn.closest('.tab-container');

            if (!container || !targetId) return;

            // 1. Deactivate all buttons in this container
            container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            // 2. Hide all content in this container
            container.querySelectorAll('.tab-content').forEach(content => content.classList.add('d-none'));

            // 3. Activate Clicked Button
            tabBtn.classList.add('active');
            // 4. Show Target Content
            const target = document.getElementById(targetId);
            if (target) target.classList.remove('d-none');
        });
    });
};





/**
 * Creates a reusable player search autocomplete
 * @param {HTMLElement} input - Search input element
 * @param {HTMLElement} resultsBox - Results container element
 * @param {Object} options - Configuration options
 */
window.SnapUtils.createPlayerAutocomplete = function (input, resultsBox, options = {}) {
    const {
        onSelect,
        excludeId = null,
        showFooter = false,
        onHide = null
    } = options;

    let debounceTimer;
    const { CONSTANTS, highlightText, escapeHtml } = window.SnapUtils;

    const hide = () => {
        resultsBox.style.display = 'none';
        if (onHide) onHide();
    };

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = input.value.trim();

        if (query.length < CONSTANTS.MIN_SEARCH_QUERY_LENGTH) {
            if (query.length > 0) {
                resultsBox.innerHTML = `
                    <div class="search-suggestion-item no-hover" style="cursor:default; color:var(--pico-muted-color); font-size: 0.85rem; padding: 15px;">
                        ${CONSTANTS.MESSAGES.SEARCH_MIN_CHARS}
                    </div>
                `;
                resultsBox.style.display = 'block';
            } else {
                hide();
            }
            return;
        }

        debounceTimer = setTimeout(async () => {
            try {
                const res = await fetch(`${CONSTANTS.API.PLAYER_SEARCH}?q=${encodeURIComponent(query)}&limit=${CONSTANTS.SEARCH_RESULTS_LIMIT}&format=json`);
                const data = await res.json();

                if (data.matches && data.matches.length > 0) {
                    const filteredMatches = excludeId
                        ? data.matches.filter(m => m.id !== excludeId)
                        : data.matches;

                    if (filteredMatches.length === 0) {
                        resultsBox.innerHTML = `
                            <div class="search-suggestion-item no-hover" style="cursor:default; color:var(--pico-muted-color); padding: 15px;">
                                ${CONSTANTS.MESSAGES.NO_RESULTS}
                            </div>
                        `;
                        resultsBox.style.display = 'block';
                        return;
                    }

                    const itemsHtml = filteredMatches.map(m => {
                        const otherNames = m.history
                            ?.map(h => h.name)
                            .filter(name => name && name !== m.name) || [];
                        const uniqueAka = [...new Set(otherNames)].slice(0, 2);
                        const akaHtml = uniqueAka.length > 0
                            ? `<div class="suggestion-aka">aka ${uniqueAka.map(a => highlightText(a, query)).join(', ')}</div>`
                            : '';

                        return `
                            <div class="search-suggestion-item" data-id="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">
                                <div class="suggestion-content">
                                    <div class="suggestion-main">
                                        <span class="suggestion-name">${highlightText(m.name, query)}</span>
                                        ${m.currentRank ? `<span class="suggestion-rank">#${m.currentRank}</span>` : ''}
                                    </div>
                                    ${akaHtml}
                                </div>
                            </div>
                        `;
                    }).join('');

                    if (showFooter) {
                        resultsBox.innerHTML = `
                            <div class="search-results-list">${itemsHtml}</div>
                            <div class="search-suggestion-item search-suggestion-footer" data-action="search">
                                See all results for "${escapeHtml(query)}"
                            </div>
                        `;
                        resultsBox.style.display = 'flex';
                    } else {
                        resultsBox.innerHTML = itemsHtml;
                        resultsBox.style.display = 'block';
                    }
                } else {
                    resultsBox.innerHTML = `
                        <div class="search-suggestion-item no-hover" style="cursor:default; color:var(--pico-muted-color); padding: 15px;">
                            ${CONSTANTS.MESSAGES.NO_RESULTS}
                        </div>
                    `;
                    resultsBox.style.display = 'block';
                }
            } catch (e) {
                hide();
            }
        }, CONSTANTS.SEARCH_DEBOUNCE_MS);
    });

    resultsBox.addEventListener('click', (e) => {
        const item = e.target.closest('.search-suggestion-item');
        if (!item) return;

        const playerId = item.dataset.id;
        const playerName = item.dataset.name;

        if (playerId && onSelect) {
            onSelect({ id: playerId, name: playerName });
            input.value = '';
            hide();
        }
    });

    return { destroy: () => { clearTimeout(debounceTimer); hide(); }, hide };
};
