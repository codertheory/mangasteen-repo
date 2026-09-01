/**
 * @name Weeb Central (Beta)
 * @version 1.0
 * @lang en
 * @iconUrl https://weebcentral.com/favicon.ico
 */

const BASE_URL = 'https://weebcentral.com';

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

// Weeb Central serves a stripped variant to non-browser clients and Cloudflare can
// escalate to a challenge on non-browser UAs, so pin a real desktop UA on every request.
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

// ISO-8601 timestamps (<time datetime="2026-09-01T15:15:52.651Z">) → Unix ms.
// Returned as a numeric string (mangaKatana convention) so a large Long never
// serializes in scientific notation for kotlinx; 0 sentinel stays a literal number.
function parseIsoDate(s) {
    if (!s) return 0;
    const t = Date.parse(s.trim());
    if (isNaN(t)) return 0;
    return t.toFixed(0);
}

// Pull the trailing number out of a chapter label ("Rating 438", "Chapter 10.5",
// "Vol.2 Chapter 10") — the last numeric token is the chapter number. -1.0 on miss.
function extractChapterNumber(name) {
    const matches = String(name).match(/\d+(?:\.\d+)?/g);
    if (matches && matches.length > 0) return parseFloat(matches[matches.length - 1]);
    return -1.0;
}

// Title comes from the cover img alt ("Blue Lock cover" / "#Gal x Gal Yuri cover"),
// which is present and consistent across every list layout. Strip the " cover" suffix.
function titleFromAlt(alt) {
    if (!alt) return "";
    return alt.replace(/\s+cover$/i, '').trim();
}

// Parse a "Full Display" card list (getPopularManga / searchManga share this layout).
function parseFullDisplayList(html) {
    const items = ksoupSelect(html, "article.bg-base-300");
    const results = [];
    for (const item of items) {
        const linkEl = ksoupSelect(item.outerHtml, 'a[href*="/series/"]')[0];
        if (!linkEl) continue;

        const titleEl = ksoupSelect(item.outerHtml, 'a.line-clamp-1')[0];
        const imgEl = ksoupSelect(item.outerHtml, 'img')[0];

        let title = titleEl ? titleEl.text.trim() : "";
        if (!title && imgEl) title = titleFromAlt(imgEl.attr["alt"]);

        // Status is shown inline as "Status: Ongoing" — best effort; details page is authoritative.
        let status = "Unknown";
        const statusMatch = item.text.match(/Status:\s*([A-Za-z ]+?)(?:\s{2,}|\n|Bad|Released|Type|Author|$)/);
        if (statusMatch) status = statusMatch[1].trim();

        results.push({
            title: title,
            url: absolutize(linkEl.attr["href"]),
            coverUrl: imgEl ? imgEl.attr["src"] : "",
            status: status,
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
 */
async function getPopularManga(page) {
    try {
        const p = page > 1 ? page : 1;
        const offset = (p - 1) * 32;
        const url = BASE_URL + '/search/data?sort=Popularity&order=Descending&official=Any' +
            '&display_mode=Full+Display&limit=32&offset=' + offset;
        const html = (await httpGet(url, { headers: defaultHeaders() })).body;
        return parseFullDisplayList(html);
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
        const html = (await httpGet(BASE_URL + '/latest-updates/' + p, { headers: defaultHeaders() })).body;
        const items = ksoupSelect(html, "article.bg-base-100");
        const results = [];

        for (const item of items) {
            // The series (manga) link — NOT the sibling /chapters/ latest-chapter link.
            const linkEl = ksoupSelect(item.outerHtml, 'a[href*="/series/"]')[0];
            const imgEl = ksoupSelect(item.outerHtml, 'img[alt$="cover"]')[0]
                || ksoupSelect(item.outerHtml, 'picture img')[0];
            const dateEl = ksoupSelect(item.outerHtml, 'time')[0];
            if (!linkEl) continue;

            let title = imgEl ? titleFromAlt(imgEl.attr["alt"]) : "";
            if (!title) {
                const t = ksoupSelect(item.outerHtml, '.font-semibold')[0];
                title = t ? t.text.trim() : "";
            }

            results.push({
                title: title,
                url: absolutize(linkEl.attr["href"]),
                coverUrl: imgEl ? imgEl.attr["src"] : "",
                status: "Unknown",
                description: "",
                author: "",
                artist: "",
                genres: [],
                lastUpdate: dateEl ? parseIsoDate(dateEl.attr["datetime"]) : 0
            });
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
        const offset = (p - 1) * 32;
        const url = BASE_URL + '/search/data?sort=Best+Match&order=Descending&official=Any' +
            '&display_mode=Full+Display&limit=32&offset=' + offset;
        const html = (await httpGet(url, {
            headers: defaultHeaders(),
            params: { text: query }
        })).body;
        return parseFullDisplayList(html);
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
        const manga = parseMangaDetailsFromHtml(html, url);
        const chapters = await fetchChapters(url);

        if (!manga.lastUpdate && chapters.length > 0) {
            manga.lastUpdate = chapters[0].uploadDate || 0;
        }

        return { manga: manga, chapters: chapters };
    } catch (error) {
        console.log("Error getting manga details: " + error);
        return null;
    }
}

function parseMangaDetailsFromHtml(html, sourceUrl) {
    const titleEl = ksoupSelect(html, "h1")[0];
    const ogImageEl = ksoupSelect(html, 'meta[property="og:image"]')[0];

    let status = "Unknown";
    let author = "";
    let genres = [];
    let released = "";
    let descFromMeta = "";

    const listItems = ksoupSelect(html, "li");
    for (const li of listItems) {
        const strongEl = ksoupSelect(li.outerHtml, "strong")[0];
        if (!strongEl) continue;
        const label = strongEl.text.trim().replace(/:\s*$/, "");
        const anchors = ksoupSelect(li.outerHtml, "a");
        // Value text = the li's full text minus the label prefix.
        const value = li.text.replace(strongEl.text, "").trim();

        if (/^Author/i.test(label)) {
            author = anchors.length > 0 ? anchors.map(a => a.text.trim()).filter(Boolean).join(", ") : value;
        } else if (/^Status/i.test(label)) {
            status = value || status;
        } else if (/^Tag/i.test(label)) {
            genres = anchors.map(a => a.text.trim()).filter(Boolean);
        } else if (/^Released/i.test(label)) {
            released = value;
        } else if (/^Description/i.test(label)) {
            descFromMeta = value;
        }
    }

    const descEl = ksoupSelect(html, "p.whitespace-pre-wrap")[0];
    const description = descEl ? descEl.text.trim() : descFromMeta;

    let title = titleEl ? titleEl.text.trim() : "";
    if (!title && ogImageEl) title = "";

    return {
        title: title,
        url: sourceUrl,
        coverUrl: ogImageEl ? ogImageEl.attr["content"] : "",
        status: status,
        description: description,
        author: author,
        artist: author,
        genres: genres,
        lastUpdate: 0
    };
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

// Series pages inline only ~9 chapters; the full list lives at a dedicated fragment
// endpoint keyed by the series ULID.
async function fetchChapters(seriesUrl) {
    const m = String(seriesUrl).match(/\/series\/([A-Z0-9]+)/);
    if (!m) return [];
    const listUrl = BASE_URL + '/series/' + m[1] + '/full-chapter-list';
    const html = (await httpGet(listUrl, { headers: defaultHeaders() })).body;

    const anchors = ksoupSelect(html, 'a[href*="/chapters/"]');
    const chapters = [];
    const seen = {};
    for (const a of anchors) {
        const href = a.attr["href"];
        if (!href) continue;
        const idMatch = href.match(/\/chapters\/([A-Z0-9]+)/);
        if (!idMatch || seen[idMatch[1]]) continue;
        seen[idMatch[1]] = true;

        const nameEl = ksoupSelect(a.outerHtml, '.grow span')[0];
        const dateEl = ksoupSelect(a.outerHtml, 'time')[0];
        const name = nameEl ? nameEl.text.trim() : a.text.trim();

        chapters.push({
            name: name,
            url: absolutize(href),
            number: extractChapterNumber(name),
            uploadDate: dateEl ? parseIsoDate(dateEl.attr["datetime"]) : 0
        });
    }
    return chapters;
}

/**
 * 6. Get Page List
 */
async function getPageList(url) {
    try {
        const m = String(url).match(/\/chapters\/([A-Z0-9]+)/);
        if (!m) return [];
        const imagesUrl = BASE_URL + '/chapters/' + m[1] +
            '/images?is_prev=False&reading_style=long_strip';
        const html = (await httpGet(imagesUrl, { headers: defaultHeaders() })).body;

        const imgs = ksoupSelect(html, 'img[src]');
        const pages = [];
        for (const img of imgs) {
            const src = img.attr["src"];
            // Skip UI chrome (icons/badges live under /static/); keep only real page scans.
            if (!src || src.indexOf("/static/") !== -1) continue;
            pages.push(src);
        }
        return pages;
    } catch (error) {
        console.log("Error getting page list: " + error);
        return [];
    }
}
