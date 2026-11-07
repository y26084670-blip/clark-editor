/* Static links, downloads and chapter text also work when opened from disk. */
function followLegacyFragment() {
    let id;
    try {
        id = decodeURIComponent(location.hash.slice(1));
    } catch {
        return;
    }
    const link = document.getElementById(id);
    if (!link?.matches('.legacy-links > a')) return;
    const target = new URL(link.href);
    target.search = location.search;
    location.replace(target.href);
}

function enableChapterNavigation(navigation) {
    const toggle = document.getElementById('menu-toggle');
    const search = document.getElementById('guide-search');
    const status = document.getElementById('search-status');
    const empty = document.getElementById('no-results');
    const entries = [...navigation.querySelectorAll('[data-chapter]')].map(link => {
        const section = document.getElementById(link.dataset.chapter);
        const formulas = [...section.querySelectorAll('img.formula')].map(image => image.alt);
        return { link, section, text: [section.textContent, ...formulas].join(' ').toLocaleLowerCase('ru') };
    });

    function setMenu(open) {
        navigation.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
    }
    function filter() {
        const words = search.value.trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
        let count = 0;
        for (const { link, section, text } of entries) {
            const matches = words.every(word => text.includes(word));
            link.hidden = section.hidden = !matches;
            if (matches) count++;
        }
        status.textContent = words.length ? 'Найдено глав: ' + count : 'Глав в разделе: ' + count;
        empty.classList.toggle('visible', count === 0);
    }

    document.documentElement.classList.add('js');
    toggle.addEventListener('click', () => setMenu(!navigation.classList.contains('open')));
    navigation.addEventListener('click', event => {
        if (event.target.closest('a') && innerWidth <= 800) setMenu(false);
    });
    document.getElementById('print-guide').addEventListener('click', () => window.print());
    search.addEventListener('input', filter);
    window.addEventListener('hashchange', () => {
        if (!search.value) return;
        search.value = '';
        filter();
        let id;
        try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
        document.getElementById(id)?.scrollIntoView();
    });
}

if (document.querySelector('.legacy-links')) {
    followLegacyFragment();
    window.addEventListener('hashchange', followLegacyFragment);
}
const chapterNavigation = document.getElementById('guide-navigation');
if (chapterNavigation?.classList.contains('toc')) enableChapterNavigation(chapterNavigation);
