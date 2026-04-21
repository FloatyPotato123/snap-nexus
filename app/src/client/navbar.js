/**
 * client/navbar.js
 * Logic for the Navigation Bar (shared component).
 * Handles: Search toggle, Autocomplete suggestions, Active link highlighting.
 */
(function () {
    // Destructure utilities and constants once at top
    const { CONSTANTS, createPlayerAutocomplete } = window.SnapUtils;

    // Wait for DOM to be ready
    window.addEventListener('DOMContentLoaded', () => {

        // --- 1. SEARCH TOGGLE & UI ---
        const navSearch = document.getElementById('navSearchInput');
        const navSearchContainer = document.getElementById('navSearchContainer');
        const navSearchList = document.getElementById('searchNavList');
        const searchToggle = document.getElementById('searchToggle');
        const searchClear = document.getElementById('searchClear');

        // Sync with URL param immediately
        const params = new URLSearchParams(window.location.search);
        const query = params.get('q') || params.get('back_q');
        if (query && navSearch) {
            navSearch.value = query;
            if (navSearchContainer) navSearchContainer.classList.remove('collapsed');
            if (navSearchList) navSearchList.classList.add('search-expanded');
        }

        // Helper to toggle clear button visibility
        const toggleClearBtn = () => {
            if (searchClear && navSearch) {
                searchClear.style.display = navSearch.value.trim() ? 'flex' : 'none';
            }
        };

        if (searchToggle && navSearchContainer) {
            searchToggle.addEventListener('click', () => {
                navSearchContainer.classList.toggle('collapsed');
                if (navSearchList) navSearchList.classList.toggle('search-expanded');

                if (!navSearchContainer.classList.contains('collapsed')) {
                    navSearch.focus();
                }
            });

            // Close when clicking outside
            document.addEventListener('click', (e) => {
                if (!navSearchContainer.contains(e.target) && !navSearchContainer.classList.contains('collapsed') && !navSearch.value) {
                    navSearchContainer.classList.add('collapsed');
                    if (navSearchList) navSearchList.classList.remove('search-expanded');
                }
            });
        }

        // Clear Button Logic
        if (searchClear && navSearch) {
            searchClear.addEventListener('click', () => {
                navSearch.value = '';
                navSearch.focus();
                toggleClearBtn();
                // Also hide suggestions
                const suggestionsBox = document.getElementById('searchSuggestions');
                if (suggestionsBox) suggestionsBox.style.display = 'none';
            });

            // Listen for input to toggle button
            navSearch.addEventListener('input', toggleClearBtn);

            // Initial check
            toggleClearBtn();
        }

        // --- 2. AUTOCOMPLETE SUGGESTIONS (Using Shared Function) ---
        if (navSearch) {
            const suggestionsBox = document.getElementById('searchSuggestions');
            let selectedIndex = -1;

            const setSelectedIndex = (index) => {
                const items = suggestionsBox.querySelectorAll('.search-suggestion-item');
                items.forEach((item, i) => {
                    item.classList.toggle('selected', i === index);
                });
                selectedIndex = index;
            };

            const hideSuggestions = () => {
                suggestionsBox.style.display = 'none';
                selectedIndex = -1;
            };

            // Use shared autocomplete function
            createPlayerAutocomplete(navSearch, suggestionsBox, {
                showFooter: true,
                onSelect: (player) => {
                    window.location.href = `/player/${encodeURIComponent(player.id)}`;
                },
                onHide: () => {
                    selectedIndex = -1;
                }
            });

            // Keyboard navigation (navbar-specific)
            navSearch.addEventListener('keydown', (e) => {
                const items = suggestionsBox.querySelectorAll('.search-suggestion-item');
                const playerMatches = Array.from(items).filter(item => item.dataset.id);

                if (e.key === 'Enter') {
                    if (suggestionsBox.style.display === 'block' || suggestionsBox.style.display === 'flex') {
                        if (selectedIndex >= 0) {
                            e.preventDefault();
                            const selected = items[selectedIndex];
                            if (selected.dataset.action === 'search') {
                                const query = navSearch.value.trim();
                                window.location.href = `/player-search?q=${encodeURIComponent(query)}`;
                            } else {
                                window.location.href = `/player/${encodeURIComponent(selected.dataset.id)}`;
                            }
                        } else if (playerMatches.length === 1) {
                            // Auto-redirect to the only result
                            e.preventDefault();
                            window.location.href = `/player/${encodeURIComponent(playerMatches[0].dataset.id)}`;
                        } else {
                            const query = navSearch.value.trim();
                            if (query) {
                                window.location.href = `/player-search?q=${encodeURIComponent(query)}`;
                            }
                        }
                    } else {
                        const query = navSearch.value.trim();
                        if (query) {
                            window.location.href = `/player-search?q=${encodeURIComponent(query)}`;
                        }
                    }
                } else if (suggestionsBox.style.display === 'block' || suggestionsBox.style.display === 'flex') {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSelectedIndex((selectedIndex + 1) % items.length);
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSelectedIndex((selectedIndex - 1 + items.length) % items.length);
                    } else if (e.key === 'Escape') {
                        hideSuggestions();
                    }
                }
            });

            // Override click handler for footer "See all results" action
            suggestionsBox.addEventListener('click', (e) => {
                const item = e.target.closest('.search-suggestion-item');
                if (item && item.dataset.action === 'search') {
                    const query = navSearch.value.trim();
                    window.location.href = `/player-search?q=${encodeURIComponent(query)}`;
                }
            });

            // Hide suggestions when clicking outside
            document.addEventListener('click', (e) => {
                if (!navSearchContainer.contains(e.target)) {
                    hideSuggestions();
                }
            });
        }

        // --- 3. ACTIVE LINK HIGHLIGHT ---
        const current = window.location.pathname;
        const navLinks = document.querySelectorAll('nav ul li a[href^="/"]');

        navLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href === '/') {
                if (current === '/') link.classList.add('active');
            } else if (current.startsWith(href)) {
                link.classList.add('active');
            }
        });

    });
})();
