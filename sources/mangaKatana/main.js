const BASE_URL = 'https://mangakatana.com';

/**
 * @typedef {Object} KsoupElement
 * @property {string} text
 * @property {string} outerHtml
 * @property {string} innerHtml
 * @property {Object.<string, string>} attr
 */

/**
 * Performs an HTTP GET request. Injected by the Android QuickJs Engine.
 * @type {function(string): Promise<string>}
 */
const httpGet = globalThis.httpGet || async function(url) {
    console.log("Mocking httpGet for: " + url);
    return "";
};

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
async function getPopularManga() {
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
 * Note: Our JsEngine interface doesn't take a page parameter for getLatestManga currently,
 * but you could easily adapt it if you add pagination later.
 */
async function getLatestManga() {
    try {
        const html = await httpGet(BASE_URL + '/');
        const items = ksoupSelect(html, "#book_list .item");
        const results = [];

        for (const item of items) {
            const titleEl = ksoupSelect(item.outerHtml, ".title a")[0];
            const imgEl = ksoupSelect(item.outerHtml, ".wrap_img img")[0];
            const statusEl = ksoupSelect(item.outerHtml, ".status")[0];

            if (titleEl && imgEl) {
                results.push({
                    title: titleEl.text.trim(),
                    url: titleEl.attr["href"],
                    coverUrl: imgEl.attr["src"],
                    status: statusEl ? statusEl.text.trim() : "Unknown",
                    description: "",
                    author: "",
                    artist: ""
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
        const searchUrl = BASE_URL + '/?search=' + encodeURIComponent(query) + '&search_by=m_name&p=' + p;

        const html = await httpGet(searchUrl);
        const items = ksoupSelect(html, "#book_list .item");
        const results = [];

        for (const item of items) {
            const titleEl = ksoupSelect(item.outerHtml, ".title a")[0];
            const imgEl = ksoupSelect(item.outerHtml, ".wrap_img img")[0];
            const statusEl = ksoupSelect(item.outerHtml, ".status")[0];

            if (titleEl && imgEl) {
                results.push({
                    title: titleEl.text.trim(),
                    url: titleEl.attr["href"],
                    coverUrl: imgEl.attr["src"],
                    status: statusEl ? statusEl.text.trim() : "Unknown",
                    description: "",
                    author: "",
                    artist: ""
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

        return {
            title: titleEl ? titleEl.text.trim() : "",
            url: url,
            coverUrl: imgEl ? imgEl.attr["src"] : "",
            status: statusEl ? statusEl.text.trim() : "Unknown",
            description: descEl ? descEl.text.trim() : "",
            author: authorNames,
            artist: authorNames // Falling back to author for artist
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