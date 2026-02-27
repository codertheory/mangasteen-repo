/**
 * @name MangaKatana (Beta)
 * @version 1.3
 * @lang en
 * @iconUrl https://mangakatana.com/favicon.ico
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
 * @type {function(string, HttpOptions=): Promise<string>}
 */
const httpGet = globalThis.httpGet;

/**
 * Parses HTML and selects elements using Ksoup. Injected by the Android QuickJs Engine.
 * @type {function(string, string): KsoupElement[]}
 */
const ksoupSelect = globalThis.ksoupSelect || function(html, selector) {
    console.log("Mocking ksoupSelect for: " + selector);
    return [];
};


/**
 * 1. Get Popular Manga (Hot Updates)
 */
async function getPopularManga(page) {
    try {
        const html = await httpGet(BASE_URL + '/');
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

        const html = await httpGet(url, options);
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

        const html = await httpGet(BASE_URL + '/', options);
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
        const html = await httpGet(url);

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

        const genreEls = ksoupSelect(html, ".genres a");
        let genres = [];
        if (genreEls && genreEls.length > 0) {
            genres = genreEls.map(el => el.text.trim());
        }

        return {
            title: titleEl ? titleEl.text.trim() : "",
            url: url,
            coverUrl: imgEl ? imgEl.attr["src"] : "",
            status: statusEl ? statusEl.text.trim() : "Unknown",
            description: descEl ? descEl.text.trim() : "",
            author: authorNames,
            artist: authorNames, // Falling back to author for artist
            genres: genres.join(", ")
        };
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
        const html = await httpGet(url);
        const rows = ksoupSelect(html, ".chapters table tbody tr");
        const chapters = [];

        for (const row of rows) {
            const linkEl = ksoupSelect(row.outerHtml, ".chapter a")[0];
            if (linkEl) {
                chapters.push({
                    name: linkEl.text.trim(),
                    url: linkEl.attr["href"],
                    number: -1.0, // Can be parsed later or left as default
                    uploadDate: 0
                });
            }
        }
        return chapters;
    } catch (error) {
        console.log("Error getting chapter list: " + error);
        return [];
    }
}

/**
 * 6. Get Page List
 * Relies entirely on native JavaScript Regex parsing, Ksoup is not needed here!
 */
async function getPageList(url) {
    try {
        const html = await httpGet(url);
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