/**
 * @name MangaKatana (Beta)
 * @version 1.8
 * @lang en
 * @iconUrl https://mangakatana.com/static/img/fav.png
 */

const BASE_URL = 'https://mangakatana.com';

/**
 * @typedef {Object} KsoupElement
 * @property {string} text
 * @property {string} outerHtml
 * @property {string} innerHtml
 * @property {Object.<string, string>} attr
 */

/**
 * @typedef {Object} HttpOptions
 * @property {string} [method] - The HTTP method (GET, POST, etc.). Defaults to GET.
 * @property {Object.<string, string>} [headers] - Key-value pair of HTTP headers.
 * @property {Object.<string, string>} [params] - Key-value pair of URL query parameters.
 * @property {string} [body] - The raw request body string (e.g. JSON.stringify or form-data).
 */

/**
 * @typedef {Object} HttpResponse
 * @property {string} body
 * @property {string} url
 * @property {number} status
 */

/**
 * @type {function(string, HttpOptions=): Promise<HttpResponse>}
 */
const httpGet = globalThis.httpGet;

/**
 * Parses HTML and selects elements using Ksoup. Injected by the Android QuickJs Engine.
 * @type {function(string, string): KsoupElement[]}
 */
const ksoupSelect = globalThis.ksoupSelect || function (html, selector) {
    console.log("Mocking ksoupSelect for: " + selector);
    return [];
};


/**
 * 1. Get Popular Manga (Hot Updates)
 */
async function getPopularManga(page) {
    try {
        if (page > 1) {
            return []; // MangaKatana has no pagination for popular manga
        }
        const html = (await httpGet(BASE_URL + '/')).body;
        const items = ksoupSelect(html, "#hot_update .item");
        const results = [];

        for (const item of items) {
            const titleEl = ksoupSelect(item.outerHtml, ".title a")[0];
            const imgEl = ksoupSelect(item.outerHtml, ".wrap_img img")[0];

            if (titleEl && imgEl) {
                results.push({
                    title: titleEl.text.trim(),
                    url: titleEl.attr["href"],
                    coverUrl: imgEl.attr["src"],
                    status: "Ongoing",
                    description: "",
                    author: "",
                    artist: ""
                });
            }
        }
        return results;
    } catch (error) {
        console.log("Error fetching popular manga: " + error);
        return [];
    }
}

/**
 * 2. Get Latest Manga (Latest Updates)
 */
async function getLatestManga(page) {
    try {
        let url = BASE_URL + '/';
        // Note: MangaKatana uses path-based pagination (/page/2),
        // but if the implementation supports it via HttpOptions params, we would use it there.
        // However, since we must use path param for this specific site:
        if (page > 1) {
            url = BASE_URL + '/page/' + page;
        }

        // Using HttpOptions for demonstration/consistency as requested
        const options = {
            method: 'GET'
        };

        const html = (await httpGet(url, options)).body;
        const items = ksoupSelect(html, "#book_list .item");
        const results = [];

        for (const item of items) {
            const titleEl = ksoupSelect(item.outerHtml, ".title a")[0];
            const imgEl = ksoupSelect(item.outerHtml, ".wrap_img img")[0];
            const statusEl = ksoupSelect(item.outerHtml, ".status")[0];
            const descEl = ksoupSelect(item.outerHtml, ".summary")[0];
            const genreEls = ksoupSelect(item.outerHtml, ".genres a");
            const dateEl = ksoupSelect(item.outerHtml, ".date")[0];

            const genres = [];
            for (const g of genreEls) {
                genres.push(g.text.trim());
            }

            if (titleEl && imgEl) {
                results.push({
                    title: titleEl.text.trim(),
                    url: titleEl.attr["href"],
                    coverUrl: imgEl.attr["src"],
                    status: statusEl ? statusEl.text.trim() : "Unknown",
                    description: descEl ? descEl.text.trim() : "",
                    author: "",
                    artist: "",
                    genres: genres,
                    lastUpdate: dateEl ? parseDate(dateEl.text.trim()) : 0,
                });
            }
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
        // Page defaults to undefined or 1 depending on how QuickJS passes it. Handled dynamically:
        const p = page > 1 ? page : 1;

        const options = {
            params: {
                search: query,
                search_by: 'm_name',
                p: p.toString()
            }
        };

        const response = await httpGet(BASE_URL + '/', options);
        const html = response.body;

        // Check if redirected to details page
        if (ksoupSelect(html, ".info .heading").length > 0 && ksoupSelect(html, "#book_list").length === 0) {
            const manga = parseMangaDetailsFromHtml(html);
            // Details page shows a relative updateAt ("2 days ago") that parseDate can't
            // decode; use the latest chapter's absolute date as a reliable proxy.
            if (!manga.lastUpdate) {
                const chapters = parseChapters(html);
                if (chapters.length > 0) manga.lastUpdate = chapters[0].uploadDate || 0;
            }
            return [manga];
        }

        const items = ksoupSelect(html, "#book_list .item");
        const results = [];

        for (const item of items) {
            const titleEl = ksoupSelect(item.outerHtml, ".title a")[0];
            const imgEl = ksoupSelect(item.outerHtml, ".wrap_img img")[0];
            const statusEl = ksoupSelect(item.outerHtml, ".status")[0];
            const genreEls = ksoupSelect(item.outerHtml, ".genres a");
            // First .date inside an item is the clock-icon absolute timestamp
            // ("Feb-25-2018"); a second .date elsewhere holds the "First Chapter" link.
            const dateEl = ksoupSelect(item.outerHtml, ".date")[0];

            const genres = [];
            for (const g of genreEls) {
                genres.push(g.text.trim());
            }

            if (titleEl && imgEl) {
                results.push({
                    title: titleEl.text.trim(),
                    url: titleEl.attr["href"],
                    coverUrl: imgEl.attr["src"],
                    status: statusEl ? statusEl.text.trim() : "Unknown",
                    description: "",
                    author: "",
                    artist: "",
                    genres: genres,
                    lastUpdate: dateEl ? parseDate(dateEl.text.trim()) : 0,
                });
            }
        }
        return results;
    } catch (error) {
        console.log("Search error: " + error);
        return [];
    }
}

/**
 * 4. Get Manga Details
 */
async function getMangaDetails(url) {
    try {
        const html = (await httpGet(url)).body;
        const manga = parseMangaDetailsFromHtml(html);
        const chapters = parseChapters(html);

        // Details-page updateAt is a relative string ("2 days ago") parseDate can't
        // read; the first chapter's absolute date is the best available fallback.
        if (!manga.lastUpdate && chapters.length > 0) {
            manga.lastUpdate = chapters[0].uploadDate || 0;
        }

        return {
            manga: manga,
            chapters: chapters,
        };
    } catch (error) {
        console.log("Error getting manga details: " + error);
        return null;
    }
}

function parseMangaDetailsFromHtml(html) {
    const ogUrlEl = ksoupSelect(html, "meta[property=og:url]")[0];
    const url = ogUrlEl ? ogUrlEl.attr["content"] : "";

    const titleEl = ksoupSelect(html, ".info .heading")[0];
    const imgEl = ksoupSelect(html, ".cover img")[0];
    const statusEl = ksoupSelect(html, ".info .status")[0];
    const descEl = ksoupSelect(html, ".summary p")[0];

    // Extract authors array and combine into a single string
    const authorEls = ksoupSelect(html, ".info .author");
    let authorNames = "";
    if (authorEls && authorEls.length > 0) {
        authorNames = authorEls.map(el => el.text.trim()).join(", ");
    }

    const genreEls = ksoupSelect(html, ".meta .genres a");
    let genres = [];
    if (genreEls && genreEls.length > 0) {
        genres = genreEls.map(el => el.text.trim());
    }

    const updateDateEl = ksoupSelect(html, ".value.updateAt")[0];
    const lastUpdate = updateDateEl ? parseDate(updateDateEl.text.trim()) : 0;

    return {
        title: titleEl ? titleEl.text.trim() : "",
        url: url,
        coverUrl: imgEl ? imgEl.attr["src"] : "",
        status: statusEl ? statusEl.text.trim() : "Unknown",
        description: descEl ? descEl.text.trim() : "",
        author: authorNames,
        artist: authorNames, // Falling back to author for artist
        genres: genres,
        lastUpdate: lastUpdate
    };
}

/**
 * 5. Get Chapter List
 */
async function getChapterList(url) {
    try {
        const html = (await httpGet(url)).body;
        return parseChapters(html);
    } catch (error) {
        console.log("Error getting chapter list: " + error);
        return [];
    }
}

// Returns Unix epoch milliseconds as a numeric string on success, or the number 0
// on failure. String return sidesteps a QuickJS quirk where large Numbers produced
// by arithmetic on Date.now() (e.g. "Date.now() - N*ms") can be JSON-serialized in
// scientific notation ("1.776E12"), which kotlinx.serialization rejects for Long.
// The host contract accepts both number and numeric string, so this is safe; the
// failure sentinel stays a literal 0 so `!manga.lastUpdate` truthy checks still work.
function parseDate(dateStr) {
    if (!dateStr) return 0;
    const months = {
        "Jan": 0, "Feb": 1, "Mar": 2, "Apr": 3, "May": 4, "Jun": 5,
        "Jul": 6, "Aug": 7, "Sep": 8, "Oct": 9, "Nov": 10, "Dec": 11
    };
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const month = months[parts[0]];
        const day = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        if (month !== undefined && !isNaN(day) && !isNaN(year)) {
            return new Date(year, month, day).getTime().toFixed(0);
        }
    }
    // Skipped in fixture mode: captured HTML freezes phrases like "2 days ago" as
    // literal text, but Date.now() keeps advancing, so the computed timestamp would
    // drift forward every test run.
    if (!globalThis.OFFLINE) return parseRelativeDate(dateStr);
    return 0;
}

// Month/year in ms use calendar averages (30.44 days / 365.25 days) — accuracy is
// roughly "unit granularity" since the site has already rounded when it chose the
// phrasing. Good enough for recency sorting, not for exact timestamps.
function parseRelativeDate(str) {
    const s = String(str).toLowerCase().trim();
    if (s === 'just now' || s === 'moments ago') return Date.now().toFixed(0);
    if (s === 'yesterday') return (Date.now() - 86400000).toFixed(0);
    const m = s.match(/^(\d+|an?)\s+(minute|hour|day|week|month|year)s?\s+ago/);
    if (!m) return 0;
    const n = (m[1] === 'a' || m[1] === 'an') ? 1 : parseInt(m[1], 10);
    const unitMs = {
        minute: 60000,
        hour:   3600000,
        day:    86400000,
        week:   604800000,
        month:  2629800000,
        year:   31557600000,
    }[m[2]];
    return (Date.now() - n * unitMs).toFixed(0);
}

function parseChapters(html) {
    const rows = ksoupSelect(html, ".chapters table tbody tr");
    const chapters = [];

    for (const row of rows) {
        const linkEl = ksoupSelect(row.outerHtml, ".chapter a")[0];
        const dateEl = ksoupSelect(row.outerHtml, ".update_time")[0];

        if (linkEl) {
            let name = linkEl.text.trim();
            // Try to extract chapter number and title
            // Typical format: "Chapter 123: Some Title"
            const regex = /Chapter\s+([0-9.]+)(?:\s*:\s*(.*))?/;
            const match = name.match(regex);
            let number = -1.0;

            if (match) {
                number = parseFloat(match[1]);
                if (match[2]) {
                    name = match[2];
                }
            }

            let uploadDate = 0;
            if (dateEl) {
                uploadDate = parseDate(dateEl.text.trim());
            }

            chapters.push({
                name: linkEl.text.trim(),
                url: linkEl.attr["href"],
                number: number,
                uploadDate: uploadDate
            });
        }
    }
    return chapters;
}

/**
 * 6. Get Page List
 * Relies entirely on native JavaScript Regex parsing, Ksoup is not needed here!
 */
async function getPageList(url) {
    try {
        const html = (await httpGet(url)).body;
        // Regex from Kotlin: thzq\s*=\s*\[(.*?)];
        const regex = /thzq\s*=\s*\[(.*?)\];/;
        const match = html.match(regex);

        if (match && match[1]) {
            // Split by comma
            return match[1].split(',').map(item => {
                return item.trim()
                    .replace(/^"|"$/g, '') // removeSurrounding("\"")
                    .replace(/"/g, '')     // replace("\"", "")
                    .replace(/'/g, '')     // replace("'", "")
                    .replace(/\\/g, '')    // replace("\\", "")
                    .replace(/i1\./g, 'i5.'); // replace("i1.", "i5.")
            });
        }
        return [];
    } catch (error) {
        console.log("Error getting page list: " + error);
        return [];
    }
}