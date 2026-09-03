/**
 * @name MangaDex (Beta)
 * @version 1.0
 * @lang en
 * @iconUrl https://mangadex.org/favicon.ico
 */

// MangaDex publishes an official, versioned public API for third-party readers
// (https://api.mangadex.org/docs). Everything here is plain JSON — no HTML parsing.
const API_URL = 'https://api.mangadex.org';
const SITE_URL = 'https://mangadex.org';
const COVERS_URL = 'https://uploads.mangadex.org';
const PAGE_LIMIT = 20;
const FEED_LIMIT = 500;      // API maximum for /manga/{id}/feed
const MAX_FEED_PAGES = 8;    // safety cap: 8 * 500 = 4000 chapters

// The API hides `pornographic` unless asked; we deliberately leave it out.
// safe/suggestive/erotica still warrants nsfw:true in extension.json.
const CONTENT_RATINGS = ['safe', 'suggestive', 'erotica'];

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

// MangaDex asks API clients for a descriptive User-Agent (NOT a spoofed browser UA).
function defaultHeaders() {
    return {
        'User-Agent': 'Mangasteen/1.0',
        'Accept': 'application/json'
    };
}

// ISO-8601 → Unix ms as a numeric string (repo convention: keeps kotlinx Long
// deserialization safe from scientific-notation Number output).
function parseIsoDate(s) {
    if (!s) return 0;
    const t = Date.parse(String(s).trim());
    if (isNaN(t)) return 0;
    return t.toFixed(0);
}

function contentRatingQs() {
    return CONTENT_RATINGS.map(r => '&contentRating%5B%5D=' + r).join('');
}

// title/description are {lang: value} maps and `en` is not guaranteed.
function pickLocalized(map) {
    if (!map) return "";
    if (map.en) return map.en;
    if (map['ja-ro']) return map['ja-ro'];
    for (const k in map) return map[k];
    return "";
}

function pickTitle(attributes) {
    const primary = pickLocalized(attributes.title);
    if (attributes.title && attributes.title.en) return attributes.title.en;
    // Prefer an English alt title over a romanized/foreign primary when one exists.
    const alts = attributes.altTitles || [];
    for (const alt of alts) {
        if (alt && alt.en) return alt.en;
    }
    return primary;
}

function capitalize(s) {
    if (!s) return "Unknown";
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function relNames(relationships, type) {
    const names = [];
    for (const r of relationships || []) {
        if (r.type === type && r.attributes && r.attributes.name) names.push(r.attributes.name);
    }
    return names.join(", ");
}

function mapManga(m) {
    const attributes = m.attributes || {};
    const rels = m.relationships || [];

    let coverUrl = "";
    for (const r of rels) {
        if (r.type === 'cover_art' && r.attributes && r.attributes.fileName) {
            // .512.jpg is a server-side thumbnail — plenty for lists, much lighter.
            coverUrl = COVERS_URL + '/covers/' + m.id + '/' + r.attributes.fileName + '.512.jpg';
            break;
        }
    }

    const genres = [];
    for (const t of attributes.tags || []) {
        const name = t && t.attributes && t.attributes.name && t.attributes.name.en;
        if (name) genres.push(name);
    }

    return {
        title: pickTitle(attributes),
        url: SITE_URL + '/title/' + m.id,
        coverUrl: coverUrl,
        status: capitalize(attributes.status),
        description: pickLocalized(attributes.description),
        author: relNames(rels, 'author'),
        artist: relNames(rels, 'artist'),
        genres: genres,
        lastUpdate: parseIsoDate(attributes.updatedAt)
    };
}

async function fetchMangaList(orderKey, page, titleQuery) {
    const p = page > 1 ? page : 1;
    const offset = (p - 1) * PAGE_LIMIT;
    let url = API_URL + '/manga?limit=' + PAGE_LIMIT + '&offset=' + offset +
        '&order%5B' + orderKey + '%5D=desc' +
        '&includes%5B%5D=cover_art' +
        contentRatingQs();
    if (titleQuery) url += '&title=' + encodeURIComponent(titleQuery);

    const res = await httpGet(url, { headers: defaultHeaders() });
    const json = JSON.parse(res.body);
    if (json.result !== 'ok' || !Array.isArray(json.data)) return [];
    return json.data.map(mapManga);
}

function mangaIdFromUrl(url) {
    const m = String(url).match(/title\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return m ? m[1] : null;
}

function chapterIdFromUrl(url) {
    const m = String(url).match(/chapter\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return m ? m[1] : null;
}

/**
 * 1. Get Popular Manga
 */
async function getPopularManga(page) {
    try {
        return await fetchMangaList('followedCount', page, null);
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
        return await fetchMangaList('latestUploadedChapter', page, null);
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
        return await fetchMangaList('relevance', page, query);
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
        const id = mangaIdFromUrl(url);
        if (!id) return null;
        const detailsUrl = API_URL + '/manga/' + id +
            '?includes%5B%5D=cover_art&includes%5B%5D=author&includes%5B%5D=artist';
        const res = await httpGet(detailsUrl, { headers: defaultHeaders() });
        const json = JSON.parse(res.body);
        if (json.result !== 'ok' || !json.data) return null;

        const manga = mapManga(json.data);
        manga.url = String(url);
        const chapters = await fetchChapters(id);
        if (!manga.lastUpdate && chapters.length > 0) {
            manga.lastUpdate = chapters[0].uploadDate || 0;
        }
        return { manga: manga, chapters: chapters };
    } catch (error) {
        console.log("Error getting manga details: " + error);
        return null;
    }
}

/**
 * 5. Get Chapter List
 */
async function getChapterList(url) {
    try {
        const id = mangaIdFromUrl(url);
        if (!id) return [];
        return await fetchChapters(id);
    } catch (error) {
        console.log("Error getting chapter list: " + error);
        return [];
    }
}

async function fetchChapters(mangaId) {
    const chapters = [];
    const seen = {};
    let offset = 0;

    for (let i = 0; i < MAX_FEED_PAGES; i++) {
        const feedUrl = API_URL + '/manga/' + mangaId + '/feed?limit=' + FEED_LIMIT +
            '&offset=' + offset +
            '&translatedLanguage%5B%5D=en' +
            '&order%5Bvolume%5D=desc&order%5Bchapter%5D=desc' +
            contentRatingQs();
        const res = await httpGet(feedUrl, { headers: defaultHeaders() });
        const json = JSON.parse(res.body);
        if (json.result !== 'ok' || !Array.isArray(json.data)) break;

        for (const c of json.data) {
            const a = c.attributes || {};
            // External chapters are official-publisher links with no pages hosted on
            // MangaDex — they cannot be read in-app, so drop them.
            if (a.externalUrl || !a.pages) continue;

            // Multiple scanlation groups upload the same chapter; keep the first
            // (feed is ordered volume desc, chapter desc — newest upload wins).
            const key = a.chapter != null ? 'ch:' + a.chapter : 'id:' + c.id;
            if (seen[key]) continue;
            seen[key] = true;

            let name;
            if (a.chapter != null) {
                name = 'Chapter ' + a.chapter;
                if (a.title) name += ': ' + a.title;
            } else {
                name = a.title || 'Oneshot';
            }

            chapters.push({
                name: name,
                url: SITE_URL + '/chapter/' + c.id,
                number: a.chapter != null ? parseFloat(a.chapter) : -1.0,
                uploadDate: parseIsoDate(a.readableAt || a.publishAt)
            });
        }

        offset += FEED_LIMIT;
        if (offset >= (json.total || 0)) break;
    }
    return chapters;
}

/**
 * 6. Get Page List
 */
async function getPageList(url) {
    try {
        const id = chapterIdFromUrl(url);
        if (!id) return [];
        // baseUrl below is a rotating MD@Home node and expires after ~15 minutes —
        // this call must happen at read time and must never be cached.
        const res = await httpGet(API_URL + '/at-home/server/' + id + '?forcePort443=true',
            { headers: defaultHeaders() });
        const json = JSON.parse(res.body);
        if (json.result !== 'ok' || !json.chapter) return [];

        const base = json.baseUrl + '/data/' + json.chapter.hash + '/';
        const pages = [];
        for (const f of json.chapter.data || []) pages.push(base + f);
        return pages;
    } catch (error) {
        console.log("Error getting page list: " + error);
        return [];
    }
}
