/**
 * @name MangaBuddy (Beta)
 * @version 1.0
 * @lang en
 * @iconUrl https://mangabuddy1.co.uk/assets/mangabuddy1couk/images/logo/mangabuddy.png
 */

// Server-rendered MangaBuddy clone (NOT the old mangabuddy.com backend, which now
// redirects elsewhere). Listings and details are SSR HTML with schema.org microdata;
// the full chapter list is a clean JSON endpoint. Page images are direct, unscrambled
// CDN URLs with no Referer requirement.
const BASE_URL = 'https://mangabuddy1.co.uk';

/**
 * @typedef {Object} KsoupElement
 * @property {string} text
 * @property {string} outerHtml
 * @property {string} innerHtml
 * @property {Object.<string, string>} attr
 */

/**
 * @typedef {Object} HttpOptions
 * @property {string} [method]
 * @property {Object.<string, string>} [headers]
 * @property {Object.<string, string>} [params]
 * @property {string} [body]
 */

/**
 * @typedef {Object} HttpResponse
 * @property {string} body
 * @property {string} url
 * @property {number} status
 */

/** @type {function(string, HttpOptions=): Promise<HttpResponse>} */
const httpGet = globalThis.httpGet;

/** @type {function(string, string): KsoupElement[]} */
const ksoupSelect = globalThis.ksoupSelect || function (html, selector) {
    console.log("Mocking ksoupSelect for: " + selector);
    return [];
};

// Pin a real desktop UA so prod (Ktor) gets the same HTML the fixtures were
// recorded with (axios sends a Chrome UA by default; Ktor does not).
function defaultHeaders() {
    return {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };
}

function absolutize(href) {
    if (!href) return "";
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("/")) return BASE_URL + href;
    return BASE_URL + "/" + href;
}

// ISO-8601 → Unix ms as a numeric string (repo convention for Long-typed fields).
function parseIsoDate(s) {
    if (!s) return 0;
    const t = Date.parse(String(s).trim());
    if (isNaN(t)) return 0;
    return t.toFixed(0);
}

// Series URLs look like /series/<slug>.<shortId>; the JSON chapter endpoint is
// keyed by the bare slug (no shortId suffix).
function slugFromUrl(url) {
    const m = String(url).match(/\/series\/([^/?#]+)\.[^/.?#]+/);
    return m ? m[1] : null;
}

// Covers are lazyloaded: data-src is authoritative, src may be a placeholder.
function imgSrc(imgEl) {
    if (!imgEl) return "";
    return imgEl.attr["data-src"] || imgEl.attr["src"] || "";
}

// Parse any block of markup containing series cover-links: an <a href=".../series/slug.id">
// wrapping the cover <img> (title from a[title] or img[alt]). Chapter links and
// text-only title links are skipped; results dedupe by series URL.
function parseSeriesCards(html) {
    const anchors = ksoupSelect(html, 'a[href*="/series/"]');
    const results = [];
    const seen = {};
    for (const a of anchors) {
        const href = a.attr["href"] || "";
        if (href.indexOf("/chapter-") !== -1) continue;
        if (!slugFromUrl(href)) continue;

        const imgEl = ksoupSelect(a.outerHtml, 'img')[0];
        if (!imgEl) continue; // only cover anchors carry the image

        const url = absolutize(href);
        if (seen[url]) continue;
        seen[url] = true;

        // Grid-card alts read "Cover of <title>"; row cards use a[title] directly.
        const title = (a.attr["title"] || imgEl.attr["alt"] || "")
            .replace(/^Cover of\s+/i, '')
            .trim();
        results.push({
            title: title,
            url: url,
            coverUrl: imgSrc(imgEl),
            status: "Unknown",
            description: "",
            author: "",
            artist: "",
            genres: []
        });
    }
    return results;
}

/**
 * 1. Get Popular Manga
 * The browse listing has no server-side popularity sort; the homepage's
 * "Most Popular" section is the only ranked list, so popular is page 1 only.
 */
async function getPopularManga(page) {
    try {
        if (page > 1) return [];
        const html = (await httpGet(BASE_URL + '/home', { headers: defaultHeaders() })).body;

        // Slice out the "Most Popular" <section> so we don't sweep up the hero
        // carousel and "Latest Releases" cards that share the same markup.
        const start = html.indexOf('Most Popular');
        let fragment = html;
        if (start !== -1) {
            const end = html.indexOf('</section>', start);
            fragment = html.substring(start, end === -1 ? html.length : end);
        }
        const results = parseSeriesCards(fragment);
        // Fallback: if the homepage layout shifts, degrade to every card on the page.
        return results.length > 0 ? results : parseSeriesCards(html);
    } catch (error) {
        console.log("Error fetching popular manga: " + error);
        return [];
    }
}

/**
 * 2. Get Latest Manga
 */
async function getLatestManga(page) {
    try {
        const p = page > 1 ? page : 1;
        const html = (await httpGet(BASE_URL + '/latest-updates', {
            headers: defaultHeaders(),
            params: { page: String(p) }
        })).body;

        // Each update row is wrapped in a div carrying data-time (the upload date).
        const rows = ksoupSelect(html, 'div[data-time]');
        if (rows.length === 0) return parseSeriesCards(html);

        const results = [];
        const seen = {};
        for (const row of rows) {
            const cards = parseSeriesCards(row.outerHtml);
            if (cards.length === 0) continue;
            const card = cards[0];
            if (seen[card.url]) continue;
            seen[card.url] = true;
            card.lastUpdate = parseIsoDate(row.attr["data-time"]);
            results.push(card);
        }
        return results;
    } catch (error) {
        console.log("Error fetching latest manga: " + error);
        return [];
    }
}

/**
 * 3. Search Manga
 */
async function searchManga(query, page) {
    try {
        const p = page > 1 ? page : 1;
        const html = (await httpGet(BASE_URL + '/series', {
            headers: defaultHeaders(),
            params: { searchTerm: query, page: String(p) }
        })).body;
        return parseSeriesCards(html);
    } catch (error) {
        console.log("Search error: " + error);
        return [];
    }
}

/**
 * 4. Get Manga Details (+ full chapter list)
 */
async function getMangaDetails(url) {
    try {
        const html = (await httpGet(url, { headers: defaultHeaders() })).body;

        const titleEl = ksoupSelect(html, 'h1[itemprop=name]')[0];
        const descEl = ksoupSelect(html, 'div[itemprop=description]')[0];
        const ogImageEl = ksoupSelect(html, 'meta[property="og:image"]')[0];

        const genres = [];
        for (const g of ksoupSelect(html, 'a[itemprop=genre]')) {
            const t = g.text.trim();
            if (t) genres.push(t);
        }

        const statusEl = ksoupSelect(html, 'a[href*="status="]')[0];
        // Authors render as one slash-joined anchor (/author/A/B/C).
        const authorEl = ksoupSelect(html, 'a[href*="/author/"]')[0];
        const author = authorEl
            ? authorEl.text.split('/').map(s => s.trim()).filter(Boolean).join(', ')
            : "";

        const manga = {
            title: titleEl ? titleEl.text.trim() : "",
            url: String(url),
            coverUrl: ogImageEl ? ogImageEl.attr["content"] : "",
            status: statusEl ? capitalize(statusEl.text.trim()) : "Unknown",
            description: descEl ? descEl.text.trim() : "",
            author: author,
            artist: author,
            genres: genres,
            lastUpdate: 0
        };

        const chapters = await fetchChapters(url);
        if (chapters.length > 0) manga.lastUpdate = chapters[0].uploadDate || 0;

        return { manga: manga, chapters: chapters };
    } catch (error) {
        console.log("Error getting manga details: " + error);
        return null;
    }
}

function capitalize(s) {
    if (!s) return "Unknown";
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * 5. Get Chapter List
 */
async function getChapterList(url) {
    try {
        return await fetchChapters(url);
    } catch (error) {
        console.log("Error getting chapter list: " + error);
        return [];
    }
}

// The series page inlines only a truncated list; the full list is JSON.
// chapter_name carries aggregator watermarks ("… EP 32 - Toomics"), so display
// names are rebuilt from the numeric chapter_num instead.
async function fetchChapters(seriesUrl) {
    const slug = slugFromUrl(seriesUrl);
    if (!slug) return [];

    const res = await httpGet(BASE_URL + '/get-chapter-list', {
        headers: defaultHeaders(),
        params: { slug: slug }
    });
    const json = JSON.parse(res.body);
    if (!json.success || !Array.isArray(json.data)) return [];

    const base = String(seriesUrl).replace(/[?#].*$/, "").replace(/\/+$/, "");
    const chapters = [];
    for (const c of json.data) {
        if (!c || !c.chapter_slug) continue;
        const num = typeof c.chapter_num === 'number' ? c.chapter_num : parseFloat(c.chapter_num);
        chapters.push({
            name: isNaN(num) ? String(c.chapter_name || c.chapter_slug) : 'Chapter ' + num,
            url: base + '/' + c.chapter_slug,
            number: isNaN(num) ? -1.0 : num,
            uploadDate: parseIsoDate(c.updated_at)
        });
    }
    // API returns newest-first already, but sort defensively by number desc.
    chapters.sort((a, b) => b.number - a.number);
    return chapters;
}

/**
 * 6. Get Page List
 */
async function getPageList(url) {
    try {
        const html = (await httpGet(url, { headers: defaultHeaders() })).body;

        // Reader page images each carry data-number; covers/UI chrome do not.
        const imgs = ksoupSelect(html, 'img[data-number]');
        const numbered = [];
        const seen = {};
        for (const img of imgs) {
            const src = imgSrc(img);
            if (!src || seen[src]) continue;
            seen[src] = true;
            const n = parseInt(img.attr["data-number"], 10);
            numbered.push({ n: isNaN(n) ? numbered.length : n, src: src });
        }
        numbered.sort((a, b) => a.n - b.n);
        return numbered.map(x => x.src);
    } catch (error) {
        console.log("Error getting page list: " + error);
        return [];
    }
}
