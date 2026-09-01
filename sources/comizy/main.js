/**
 * @name Comizy (Beta)
 * @version 1.0
 * @lang en
 * @iconUrl https://comizy.io/static/sites/comizy/icons/favicon-32x32.png
 */

// mangabuddy.com now redirects here; Comizy is the same operator's current brand and
// the one that actually serves content. The JSON API lives on a separate host.
const BASE_URL = 'https://comizy.io';
const API_URL = 'https://api.comizy.io';
const PAGE_LIMIT = 24;

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

// The API answers a browser-shaped request; send a real UA plus the site Origin/Referer.
function defaultHeaders() {
    return {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Origin': BASE_URL,
        'Referer': BASE_URL + '/'
    };
}

function absolutize(href) {
    if (!href) return "";
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("/")) return BASE_URL + href;
    return BASE_URL + "/" + href;
}

// First path segment of a manga URL is its vanity slug (…/behind-the-stage[/chapter-44]).
function slugFromUrl(url) {
    const rest = String(url).replace(/^https?:\/\/[^/]+\//, '');
    return rest.split('?')[0].split('/')[0];
}

function titleCase(s) {
    if (!s) return "";
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// ISO-8601 (updated_at: "2026-08-31T19:45:02.000Z") → Unix ms as a numeric string
// (mangaKatana convention, keeps a Long out of scientific notation); 0 sentinel on miss.
function parseIsoDate(s) {
    if (!s) return 0;
    const t = Date.parse(s);
    if (isNaN(t)) return 0;
    return t.toFixed(0);
}

// Display chapter number lives in the name ("Chapter 44"); the API's numeric `number`
// field is an internal position index, not the label, so parse the name instead.
function extractChapterNumber(name) {
    const m = String(name).match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : -1.0;
}

function mapListItem(it) {
    const genres = Array.isArray(it.genres) ? it.genres.map(g => g.name).filter(Boolean) : [];
    return {
        title: it.name || "",
        url: absolutize(it.url),
        coverUrl: it.cover || "",
        status: titleCase(it.status || ""),
        description: it.summary || "",
        author: "",
        artist: "",
        genres: genres,
        lastUpdate: parseIsoDate(it.updated_at)
    };
}

async function fetchItems(params) {
    const resp = await httpGet(API_URL + '/titles/search', { headers: defaultHeaders(), params: params });
    const json = JSON.parse(resp.body);
    const items = (json && json.data && json.data.items) || [];
    return items.map(mapListItem);
}

/**
 * 1. Get Popular Manga
 */
async function getPopularManga(page) {
    try {
        const p = page > 1 ? page : 1;
        return await fetchItems({ sort: 'popular', page: p, limit: PAGE_LIMIT });
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
        return await fetchItems({ page: p, limit: PAGE_LIMIT });
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
        return await fetchItems({ q: query, page: p, limit: PAGE_LIMIT });
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
        const title = await fetchTitle(slugFromUrl(url));
        if (!title) return null;

        const authors = Array.isArray(title.authors) ? title.authors.map(a => a.name).filter(Boolean).join(", ") : "";
        const artists = Array.isArray(title.artists) ? title.artists.map(a => a.name).filter(Boolean).join(", ") : "";
        const genres = Array.isArray(title.genres) ? title.genres.map(g => g.name).filter(Boolean) : [];

        const manga = {
            title: title.name || "",
            url: absolutize(title.url) || url,
            coverUrl: title.cover || "",
            status: titleCase(title.status || ""),
            description: title.summary || "",
            author: authors,
            artist: artists || authors,
            genres: genres,
            lastUpdate: parseIsoDate(title.updated_at)
        };

        const chapters = await fetchChapters(title.id);
        return { manga: manga, chapters: chapters };
    } catch (error) {
        console.log("Error getting manga details: " + error);
        return null;
    }
}

// by-slug resolves the vanity slug to the record we need — including the internal id
// the chapters endpoint is keyed on.
async function fetchTitle(slug) {
    const resp = await httpGet(API_URL + '/titles/by-slug/' + slug, {
        headers: defaultHeaders(),
        params: { include: 'details' }
    });
    const json = JSON.parse(resp.body);
    return (json && json.data && json.data.title) || null;
}

/**
 * 5. Get Chapter List
 */
async function getChapterList(url) {
    try {
        const title = await fetchTitle(slugFromUrl(url));
        if (!title) return [];
        return await fetchChapters(title.id);
    } catch (error) {
        console.log("Error getting chapter list: " + error);
        return [];
    }
}

// The title record inlines only the newest ~50 chapters; the dedicated endpoint returns
// the COMPLETE list in a single call. `limit` is validated to 1..500 ("Limit must be
// between 1 and 500") but does not actually cap the count — a 1300+ chapter series still
// comes back whole — and `page` is ignored, so one request at limit=500 gets everything.
async function fetchChapters(mangaId) {
    if (!mangaId) return [];
    const resp = await httpGet(API_URL + '/titles/' + mangaId + '/chapters', {
        headers: defaultHeaders(),
        params: { page: 1, limit: 500 }
    });
    const json = JSON.parse(resp.body);
    const chapters = (json && json.data && json.data.chapters) || [];
    return chapters.map(ch => ({
        name: ch.name || "",
        url: absolutize(ch.url),
        number: extractChapterNumber(ch.name),
        uploadDate: parseIsoDate(ch.updated_at)
    }));
}

/**
 * 6. Get Page List
 * The reader page embeds the ordered image list in its Next.js data blob, so a single
 * fetch of the chapter URL yields the pages with no id resolution. Images are full-page
 * WebP (not scrambled); they are hotlink-protected and need a comizy.io Referer when loaded.
 */
async function getPageList(url) {
    try {
        const html = (await httpGet(url, { headers: defaultHeaders() })).body;
        const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!m) return [];
        const data = JSON.parse(m[1]);
        const pages = data && data.props && data.props.pageProps &&
            data.props.pageProps.initialChapter && data.props.pageProps.initialChapter.pages;
        if (!Array.isArray(pages)) return [];
        return pages.map(p => p.url).filter(Boolean);
    } catch (error) {
        console.log("Error getting page list: " + error);
        return [];
    }
}
