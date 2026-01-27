/**
 * client/search.js
 * Logic for the Player Search page.
 */
(function () {
    const $ = SnapUtils.$;

    // Check URL params on load
    window.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        const query = params.get('q');

        if (query) {
            searchPlayer();
        }
    });

    let currentCursor = 0;
    let currentQuery = '';
    let isLoadingMore = false;

    window.searchPlayer = async function (isLoadMore = false) {
        const navSearch = document.getElementById('navSearchInput');
        const query = navSearch ? navSearch.value.trim() : '';
        const resDiv = $('searchResults');
        const loadMoreBtn = $('loadMoreBtn');
        const loadMoreContainer = $('loadMoreContainer');

        if (!query) {
            resDiv.innerHTML = '';
            loadMoreContainer.style.display = 'none';
            return;
        }

        if (!isLoadMore) {
            currentCursor = 0;
            currentQuery = query;

            // Update URL without reloading
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('q', query);
            window.history.pushState({}, '', newUrl);

            resDiv.innerHTML = '<div class="status-msg">Searching...</div>';
            loadMoreContainer.style.display = 'none';
        } else {
            isLoadingMore = true;
            loadMoreBtn.setAttribute('aria-busy', 'true');
        }

        try {
            const req = await fetch(`/api/players/search?q=${encodeURIComponent(query)}&cursor=${currentCursor}`);
            if (!req.ok) throw new Error(await req.text());
            const data = await req.json();

            if (!isLoadMore && data.matches.length === 0) {
                resDiv.innerHTML = `<div class="no-results"><span class="icon">🔍</span>No players found. Try a different name or check your spelling.</div>`;
                loadMoreContainer.style.display = 'none';
                return;
            }

            // Clear "Searching..." only on first load
            if (!isLoadMore) resDiv.innerHTML = '';

            // Turn off button loading state
            if (isLoadMore) {
                isLoadingMore = false;
                loadMoreBtn.setAttribute('aria-busy', 'false');
            }

            data.matches.forEach(match => {
                // Filter "Also Known As"
                const otherNames = match.history
                    .map(h => h.name)
                    .filter(n => n !== match.name);
                const uniqueAlsoKnown = [...new Set(otherNames)];

                const akaStr = uniqueAlsoKnown.length > 0
                    ? `<div class="text-muted text-small mt-10">Also known as: <span style="font-style:italic; color:var(--pico-muted-color);">${uniqueAlsoKnown.slice(0, 3).join(', ')}${uniqueAlsoKnown.length > 3 ? '...' : ''}</span></div>`
                    : '';

                // Pass params
                const profileUrl = `/player/${match.id}?back_q=${encodeURIComponent(query)}`;

                // Rank Badge
                let rankHtml = '';
                if (match.currentRank) {
                    rankHtml = `<div class="tag-rank">Rank ${match.currentRank}</div>`;
                }

                // Clickable Card -> Profile
                const cardHTML = `
            <a href="${profileUrl}" class="card-clickable border-purple card-slim" style="text-decoration:none; display:flex !important; color:inherit;">
                <article style="margin:0; background:transparent; border:none; padding:0; display:flex; width:100%; align-items:center; justify-content:space-between;">
                    <div class="match-info">
                        ${rankHtml}
                        <div>
                            <h3 class="text-gold mb-0">${match.name}</h3>
                            ${akaStr ? akaStr.replace('<div class="text-muted text-small mt-10">', '<div class="aka-text">').replace('</div>', '</div>') : ''} 
                        </div>
                    </div>
                    <div class="text-gold" style="font-size:1.5rem;">›</div>
                </article>
            </a>`;

                // Append to div
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = cardHTML;
                resDiv.appendChild(tempDiv.firstElementChild);
            });

            // If no matches, show friendly message
            if (data.matches.length === 0) {
                resDiv.innerHTML = `<div class="no-results"><span class="icon">🔍</span>No players found. Try a different name or check your spelling.</div>`;
            }

            // Handle Pagination Button
            if (data.nextCursor) {
                currentCursor = data.nextCursor;
                loadMoreContainer.style.display = 'block';
                loadMoreBtn.innerText = `Load More (${data.matches.length} shown of ${data.total})`;
            } else {
                loadMoreContainer.style.display = 'none';
            }

        } catch (e) {
            if (!isLoadMore) resDiv.innerHTML = `<div class="error-msg">Error: ${e.message}</div>`;
            else alert("Failed to load more results.");
            console.error(e);
        }
    }
})();
