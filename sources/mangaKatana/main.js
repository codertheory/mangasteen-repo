/**
 * @name MangaKatana (Beta)
 * @version 1.7
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
                    genres: genres.join(", ")
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
            return [manga];
        }

        const items = ksoupSelect(html, "#book_list .item");
        const results = [];

        for (const item of items) {
            const titleEl = ksoupSelect(item.outerHtml, ".title a")[0];
            const imgEl = ksoupSelect(item.outerHtml, ".wrap_img img")[0];
            const statusEl = ksoupSelect(item.outerHtml, ".status")[0];
            const genreEls = ksoupSelect(item.outerHtml, ".genres a");

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
                    genres: genres.join(", ")
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
    let lastUpdate = "";
    if (updateDateEl) {
        lastUpdate = parseDate(updateDateEl.text.trim());
    }

    return {
        title: titleEl ? titleEl.text.trim() : "",
        url: url,
        coverUrl: imgEl ? imgEl.attr["src"] : "",
        status: statusEl ? statusEl.text.trim() : "Unknown",
        description: descEl ? descEl.text.trim() : "",
        author: authorNames,
        artist: authorNames, // Falling back to author for artist
        genres: genres.join(", "),
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

function parseDate(dateStr) {
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
            return new Date(year, month, day).getTime().toString();
        }
    }
    return 0;
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