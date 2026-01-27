/**
 * client/navbar.js
 * Logic for the Navigation Bar (shared component).
 * Handles: Search toggle, Autocomplete suggestions, Active link highlighting.
 */
(function () {
    // Wait for DOM to be ready
    window.addEventListener('DOMContentLoaded', () => {

        // --- 1. SEARCH TOGGLE & UI ---
        const navSearch = document.getElementById('navSearchInput');
        const navSearchContainer = document.getElementById('navSearchContainer');
        const navSearchList = document.getElementById('searchNavList');
        const searchToggle = document.getElementById('searchToggle');

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

        // --- 2. AUTOCOMPLETE SUGGESTIONS ---
        if (navSearch) {
            const suggestionsBox = document.getElementById('searchSuggestions');
            let debounceTimer;
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

            navSearch.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                const query = navSearch.value.trim();

                if (query.length < 3) {
                    hideSuggestions();
                    return;
                }

                debounceTimer = setTimeout(async () => {
                    try {
                        const res = await fetch(`/api/players/search?q=${encodeURIComponent(query)}&limit=5&format=json`);
                        const data = await res.json();

                        const highlightText = (text, q) => {
                            if (!q || !text) return text;
                            // Escape regex characters in query
                            const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(`(${escapedQ})`, 'gi');
                            return text.replace(regex, '<strong>$1</strong>');
                        };

                        if (data.matches && data.matches.length > 0) {
                            suggestionsBox.innerHTML = data.matches.map(m => {
                                const otherNames = m.history
                                    .map(h => h.name)
                                    .filter(name => name && name !== m.name);
                                const uniqueAka = [...new Set(otherNames)].slice(0, 2);
                                const akaHtml = uniqueAka.length > 0
                                    ? `<div class="suggestion-aka">aka ${uniqueAka.map(a => highlightText(a, query)).join(', ')}</div>`
                                    : '';

                                return `
                                    <div class="search-suggestion-item" data-id="${m.id}">
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

                            // Add "See all results" footer
                            suggestionsBox.innerHTML += `
                                <div class="search-suggestion-item search-suggestion-footer" data-action="search">
                                    See all results for "${query}"
                                </div>
                            `;

                            suggestionsBox.style.display = 'block';
                            selectedIndex = -1;
                        } else {
                            hideSuggestions();
                        }
                    } catch (e) {
                        hideSuggestions();
                    }
                }, 250);
            });

            navSearch.addEventListener('keydown', (e) => {
                const items = suggestionsBox.querySelectorAll('.search-suggestion-item');
                const playerMatches = Array.from(items).filter(item => item.dataset.id);

                if (e.key === 'Enter') {
                    if (suggestionsBox.style.display === 'block') {
                        if (selectedIndex >= 0) {
                            e.preventDefault();
                            const selected = items[selectedIndex];
                            if (selected.dataset.action === 'search') {
                                const query = navSearch.value.trim();
                                window.location.href = `/player-search?q=${encodeURIComponent(query)}`;
                            } else {
                                window.location.href = `/player/${selected.dataset.id}`;
                            }
                        } else if (playerMatches.length === 1) {
                            // Auto-redirect to the only result
                            e.preventDefault();
                            window.location.href = `/player/${playerMatches[0].dataset.id}`;
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
                } else if (suggestionsBox.style.display === 'block') {
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

            suggestionsBox.addEventListener('click', (e) => {
                const item = e.target.closest('.search-suggestion-item');
                if (item) {
                    if (item.dataset.action === 'search') {
                        const query = navSearch.value.trim();
                        window.location.href = `/player-search?q=${encodeURIComponent(query)}`;
                    } else {
                        window.location.href = `/player/${item.dataset.id}`;
                    }
                }
            });

            // Hide suggestions when clicking outside
            document.addEventListener('click', (e) => {
                if (!navSearchContainer.contains(e.target)) {
                    hideSuggestions();
                }
            });

            // Sync with URL param
            const params = new URLSearchParams(window.location.search);
            const query = params.get('q') || params.get('back_q');
            if (query) {
                navSearch.value = query;
                navSearchContainer.classList.remove('collapsed');
                if (navSearchList) navSearchList.classList.add('search-expanded');
            }
        }

        // --- 3. ACTIVE LINK HIGHLIGHT ---
        const current = window.location.pathname;
        const navLinks = document.querySelectorAll('nav ul li a[href^="/"]:not(.logo-link)');

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
