/**
 * @name Mangago (Beta)
 * @version 1.3
 * @lang en
 * @iconUrl https://www.mangago.me/favicon.ico
 */

const DOMAIN = 'mangago.me';
const BASE_URL = 'https://www.' + DOMAIN;

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

/**
 * @type {function(string, HttpOptions=): Promise<HttpResponse>}
 */
const httpGet = globalThis.httpGet;

/**
 * @type {function(string, string): KsoupElement[]}
 */
const ksoupSelect = globalThis.ksoupSelect || function (html, selector) {
    console.log("Mocking ksoupSelect for: " + selector);
    return [];
};

// Note: the manual Cookie header intentionally bypasses the host's auto-injected
// per-source cookie jar for this bootstrap cookie (_m_superu=1 unlocks adult filters).
// Any Set-Cookie from responses still persists to the jar, but jar cookies are only
// merged in on requests that don't set the header themselves — so requests made via
// `defaultHeaders()` will always carry exactly this cookie and nothing else.
//
// User-Agent is set explicitly because mangago serves a stripped HTML variant to
// non-browser clients (no date column in #chapter_table, which made every chapter
// show "56 years ago" in production). Our fixtures were captured from a real
// browser, so pinning this UA keeps local behavior and device behavior aligned.
function defaultHeaders() {
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': BASE_URL + '/',
        'Cookie': '_m_superu=1'
    };
}

function absolutize(href) {
    if (!href) return "";
    if (href.startsWith("//")) return "https:" + href;
    if (href.startsWith("/")) return BASE_URL + href;
    return href;
}

/**
 * 1. Get Popular Manga (sorted by views)
 */
async function getPopularManga(page) {
    try {
        const p = page > 0 ? page : 1;
        const url = BASE_URL + '/genre/all/' + p + '/?f=1&o=1&sortby=view&e=';
        const html = (await httpGet(url, { headers: defaultHeaders() })).body;
        return parseMangaList(html);
    } catch (error) {
        console.log("Error fetching popular manga: " + error);
        return [];
    }
}

/**
 * 2. Get Latest Manga (sorted by update_date)
 */
async function getLatestManga(page) {
    try {
        const p = page > 0 ? page : 1;
        const url = BASE_URL + '/genre/all/' + p + '/?f=1&o=1&sortby=update_date&e=';
        const html = (await httpGet(url, { headers: defaultHeaders() })).body;
        return parseMangaList(html);
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
        const p = page > 0 ? page : 1;
        const options = {
            params: { name: query, page: p.toString() },
            headers: defaultHeaders()
        };
        const html = (await httpGet(BASE_URL + '/r/l_search/', options)).body;
        return parseMangaList(html);
    } catch (error) {
        console.log("Search error: " + error);
        return [];
    }
}

function parseMangaList(html) {
    const items = ksoupSelect(html, ".updatesli, .pic_list > li");
    const results = [];
    for (const item of items) {
        const linkEl = ksoupSelect(item.outerHtml, ".thm-effect")[0];
        if (!linkEl) continue;
        const imgEl = ksoupSelect(linkEl.outerHtml, "img")[0];
        let title = linkEl.attr["title"] || "";
        if (!title && imgEl) title = imgEl.attr["alt"] || "";
        const href = absolutize(linkEl.attr["href"] || "");
        let coverUrl = "";
        if (imgEl) {
            coverUrl = imgEl.attr["data-src"] || imgEl.attr["src"] || "";
            coverUrl = absolutize(coverUrl);
        }
        if (title && href) {
            results.push({
                title: title.trim(),
                url: href,
                coverUrl: coverUrl,
                status: "Unknown",
                description: "",
                author: "",
                artist: ""
            });
        }
    }
    return results;
}

/**
 * 4. Get Manga Details
 */
async function getMangaDetails(url) {
    try {
        const response = await httpGet(url, { headers: defaultHeaders() });
        const html = response.body;
        const manga = parseMangaDetailsFromHtml(html, response.url || url);
        const chapters = parseChapters(html);
        return { manga: manga, chapters: chapters };
    } catch (error) {
        console.log("Error getting manga details: " + error);
        return null;
    }
}

function parseMangaDetailsFromHtml(html, sourceUrl) {
    const titleEl = ksoupSelect(html, ".w-title h1")[0];
    const infoEls = ksoupSelect(html, "#information");
    let coverUrl = "";
    let description = "";
    let author = "";
    let artist = "";
    let genres = [];
    let status = "Unknown";
    let alternative = "";
    let lastUpdate = 0;

    if (infoEls.length > 0) {
        const infoHtml = infoEls[0].outerHtml;
        const coverImg = ksoupSelect(infoHtml, "img")[0];
        if (coverImg) coverUrl = absolutize(coverImg.attr["src"] || coverImg.attr["data-src"] || "");

        const summaryEl = ksoupSelect(infoHtml, ".manga_summary")[0];
        if (summaryEl) {
            const cleanedHtml = (summaryEl.innerHtml || "").replace(/<font[\s\S]*?<\/font>/gi, '');
            const cleanedEl = ksoupSelect('<div>' + cleanedHtml + '</div>', 'div')[0];
            description = (cleanedEl ? cleanedEl.text : summaryEl.text).replace(/\s+/g, ' ').trim();
        }

        const rows = ksoupSelect(infoHtml, ".manga_info li, .manga_right tr");
        for (const row of rows) {
            const labelEl = ksoupSelect(row.outerHtml, "b, label")[0];
            if (!labelEl) continue;
            const label = labelEl.text.trim().toLowerCase();
            if (label === "alternative:") {
                alternative = row.text.replace(/^\s*alternative:\s*/i, '').trim();
            } else if (label === "status:") {
                const statusSpan = ksoupSelect(row.outerHtml, "span")[0];
                if (statusSpan) {
                    const s = statusSpan.text.trim().toLowerCase();
                    if (s === "ongoing") status = "Ongoing";
                    else if (s === "completed") status = "Completed";
                    else status = statusSpan.text.trim() || "Unknown";
                }
            } else if (label === "author(s):" || label === "author:") {
                const authorLinks = ksoupSelect(row.outerHtml, "a");
                author = authorLinks.map(a => a.text.trim()).filter(Boolean).join(", ");
                artist = author;
            } else if (label === "genre(s):") {
                const genreLinks = ksoupSelect(row.outerHtml, "a");
                genres = genreLinks.map(a => a.text.trim()).filter(Boolean);
            } else if (label === "last update:" || label === "updated:") {
                const valText = row.text.replace(/^[^:]*:\s*/, '').trim();
                lastUpdate = parseMangagoDate(valText);
            }
        }

        if (alternative) {
            description = description
                ? (description + "\n\nAlternative: " + alternative)
                : ("Alternative: " + alternative);
        }
    }

    return {
        title: titleEl ? titleEl.text.trim() : "",
        url: sourceUrl || "",
        coverUrl: coverUrl,
        status: status,
        description: description,
        author: author,
        artist: artist,
        genres: genres,
        lastUpdate: lastUpdate
    };
}

/**
 * 5. Get Chapter List
 */
async function getChapterList(url) {
    try {
        const html = (await httpGet(url, { headers: defaultHeaders() })).body;
        return parseChapters(html);
    } catch (error) {
        console.log("Error getting chapter list: " + error);
        return [];
    }
}

const MONTHS = {
    "jan": 0, "feb": 1, "mar": 2, "apr": 3, "may": 4, "jun": 5,
    "jul": 6, "aug": 7, "sep": 8, "oct": 9, "nov": 10, "dec": 11
};

// Returns Unix epoch milliseconds as a numeric string on success, or the number 0
// on failure. String return sidesteps a QuickJS quirk where large Number values get
// JSON-serialized in scientific notation ("1.776E12"), which kotlinx.serialization
// rejects for Long fields — manifests as every chapter showing "56 years ago" (1970
// epoch) in the app. The host contract accepts both numbers and numeric strings; the
// failure sentinel stays a literal 0 so `if (!record.uploadDate)` truthy checks still
// work in the rare path that inspects the value client-side.
function parseMangagoDate(dateStr) {
    console.log("parseMangagoDate", dateStr);
    if (!dateStr) return 0;
    const m = dateStr.match(/([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
    if (m) {
        console.log("Found date", m)
        const month = MONTHS[m[1].toLowerCase()];
        const day = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);
        if (month !== undefined && !isNaN(day) && !isNaN(year)) {
            return new Date(year, month, day).getTime().toFixed(0);
        }
    }
    console.log("Did not found date in expected format");
    return 0;
}

function parseChapters(html) {
    // Stay scoped to the real chapter table — the `.uk-table` fallback that used to
    // live here matched unrelated UIkit tables on some detail pages, producing ghost
    // rows with empty last-td text that polluted uploadDate with 0 (1970 epoch).
    const rows = ksoupSelect(html, "table#chapter_table > tbody > tr");
    const chapters = [];
    for (const row of rows) {
        const linkEl = ksoupSelect(row.outerHtml, "a.chico")[0];
        if (!linkEl) continue;
        const chapterUrl = absolutize(linkEl.attr["href"] || "");
        const name = linkEl.text.trim();

        // Ksoup follows the HTML5 spec strictly: a <tr> parsed as a standalone
        // fragment is foster-parented (the <tr> + its <td> descendants get dropped)
        // because they're invalid outside a <table> context. Cheerio is lenient and
        // keeps them, which is why fixtures passed but device saw tds.length=0.
        // Wrapping in minimal table scaffolding gives Ksoup what it needs.
        const wrappedRow = '<table><tbody>' + row.outerHtml + '</tbody></table>';
        const tds = ksoupSelect(wrappedRow, "td");
        const dateText = tds.length > 0 ? tds[tds.length - 1].text.trim() : "";

        let number = -1.0;
        const chMatch = name.match(/(?:ch(?:apter)?\.?|#)\s*([0-9]+(?:\.[0-9]+)?)/i);
        const anyNum = name.match(/([0-9]+(?:\.[0-9]+)?)/);
        const match = chMatch || anyNum;
        if (match) {
            const n = parseFloat(match[1]);
            if (!isNaN(n)) number = n;
        }

        chapters.push({
            name: name,
            url: chapterUrl,
            number: number,
            uploadDate: parseMangagoDate(dateText)
        });
    }
    return chapters;
}

/**
 * 6. Get Page List
 *
 * Mangago obfuscates page images:
 *   1. `imgsrcs` (base64) is AES-CBC ciphertext of the CSV image URL list.
 *   2. The AES key + IV live in a sojson.v4-obfuscated `chapter.js` companion script.
 *   3. The decrypted list is further scrambled; chapter.js contains the unscramble keys.
 *   4. Each image served from `cspiclink` domains is a tile-scrambled JPEG; a per-image
 *      `desckey` computed from the URL tells the client how to reassemble tiles via canvas.
 *
 * This function does steps 1–3 and appends `#desckey=<k>&cols=<n>` fragments as per
 * the Tachiyomi extension so the host runtime can reassemble tiles (canvas work must
 * happen natively — QuickJS has no graphics primitives).
 */
async function getPageList(url) {
    try {
        const response = await httpGet(url, { headers: defaultHeaders() });
        return await getChapterImageUrls(response.body, response.url || url);
    } catch (error) {
        console.log("Error getting page list: " + error);
        return [];
    }
}

// Fetches chapter.js once, decrypts the first page's imgsrcs, and — if the payload
// is sparse (the .zone mirror delivers images in chunks; page /1/ fills only slots
// 0..4 out of total_pages) — walks the paginated URLs built from the `curl` template
// using the stride derived from next_url, merging each chunk by array index.
// The .me mirror typically returns all slots on page /1/, so the loop short-circuits.
async function getChapterImageUrls(html, startUrl) {
    const chapterJsTag = html.match(/<script[^>]+src=["']([^"']*chapter\.js[^"']*)["']/);
    if (!chapterJsTag) throw new Error("chapter.js script tag not found");
    const chapterJsUrl = absolutize(chapterJsTag[1]);
    const chapterJsSrc = (await httpGet(chapterJsUrl, { headers: defaultHeaders() })).body;
    const chapterJs = deobfuscateSoJsonV4(chapterJsSrc);

    const keyHex = findHexVar(chapterJs, "key");
    const ivHex = findHexVar(chapterJs, "iv");
    if (!keyHex || !ivHex) throw new Error("AES key/iv not found in chapter.js");

    // Mangago's `imgsrcs` is zero-padded rather than PKCS7-padded, so we use the host's
    // no-padding decrypt and strip trailing null bytes ourselves.
    function decryptChunk(chunkHtml) {
        const m = chunkHtml.match(/var\s+imgsrcs\s*=\s*['"]([a-zA-Z0-9+=/]+)['"]/);
        if (!m) return [];
        const decrypted = crypto.aesCbcDecrypt(keyHex, ivHex, m[1], "none");
        const stripped = decrypted.replace(/\x00+$/, "");
        const unscrambled = unscrambleImageList(stripped, chapterJs);
        return unscrambled.split(",").map(u => u.trim());
    }

    const collected = decryptChunk(html);
    const totalPagesMatch = html.match(/total_pages\s*=\s*(\d+)/);
    const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : collected.length;
    const realCount = (arr) => {
        let n = 0;
        for (const u of arr) if (u !== "") n++;
        return n;
    };

    if (realCount(collected) < totalPages) {
        // Sparse first page — follow the chunked pagination. Derive stride from
        // next_url (e.g. current_page=1, next_url=.../6/ → stride 5) and generate
        // URLs via the `curl` template; following next_url directly is unreliable
        // because the last partial chunk's next_url jumps to the next chapter.
        const curlMatch = html.match(/id=["']curl["']\s+value=["']([^"']+)["']/);
        const nextUrlMatch = html.match(/next_url\s*=\s*["']([^"']+)["']/);
        const currentPageMatch = html.match(/current_page\s*=\s*(\d+)/);
        const currentPage = currentPageMatch ? parseInt(currentPageMatch[1], 10) : 1;
        let stride = 0;
        if (nextUrlMatch) {
            const np = nextUrlMatch[1].match(/\/(\d+)\/?$/);
            if (np) stride = parseInt(np[1], 10) - currentPage;
        }
        if (curlMatch && stride > 0) {
            const template = curlMatch[1];
            let origin = BASE_URL;
            try { origin = new URL(startUrl).origin; } catch (_) {}
            for (let pg = currentPage + stride; pg <= totalPages; pg += stride) {
                const pageUrl = origin + template.replace("{page}", String(pg));
                const resp = await httpGet(pageUrl, { headers: defaultHeaders() });
                const chunk = decryptChunk(resp.body);
                for (let i = 0; i < chunk.length && i < collected.length; i++) {
                    if (chunk[i] !== "" && collected[i] === "") collected[i] = chunk[i];
                }
                if (realCount(collected) >= totalPages) break;
            }
        }
    }

    const colsMatch = chapterJs.match(/var\s*widthnum\s*=\s*heightnum\s*=\s*(\d+);/);
    const cols = colsMatch ? colsMatch[1] : "";

    const renStart = "var renImg = function(img,width,height,id){";
    const renEnd = "key = key.split(";
    const renIdx = chapterJs.indexOf(renStart);
    const imgKeysBlock = renIdx >= 0
        ? (function () {
            const tail = chapterJs.substring(renIdx + renStart.length);
            const j = tail.indexOf(renEnd);
            return j >= 0 ? tail.substring(0, j) : tail;
        })()
        : "";
    const jsFilters = ["jQuery", "document", "getContext", "toDataURL", "getImageData", "width", "height"];
    const imgKeys = imgKeysBlock.split("\n")
        .filter(line => jsFilters.every(f => !line.includes(f)))
        .join("\n")
        .replace(/img\.src/g, "url");

    const results = [];
    for (const u of collected) {
        if (u === "") continue;
        if (u.indexOf("cspiclink") >= 0 && imgKeys) {
            const descKey = computeDescKey(imgKeys, u);
            if (descKey) { results.push(u + "#descrambler=mangago&desckey=" + descKey + "&cols=" + cols); continue; }
        }
        results.push(u);
    }
    return results;
}

function deobfuscateSoJsonV4(jsf) {
    if (!jsf.startsWith("['sojson.v4']")) {
        throw new Error("Obfuscated code is not sojson.v4");
    }
    const slice = jsf.substring(240, jsf.length - 59);
    return slice.split(/[a-zA-Z]+/)
        .filter(s => s.length > 0)
        .map(s => String.fromCharCode(parseInt(s, 10)))
        .join('');
}

function findHexVar(js, name) {
    const re = new RegExp('var\\s+' + name + '\\s*=\\s*CryptoJS\\.enc\\.Hex\\.parse\\(\\s*"([0-9a-zA-Z]+)"\\s*\\)');
    const m = js.match(re);
    return m ? m[1] : "";
}

function unscrambleImageList(imageList, js) {
    const keyLocRegex = /str\.charAt\(\s*(\d+)\s*\)/g;
    const seen = {};
    const keyLocations = [];
    let m;
    while ((m = keyLocRegex.exec(js)) !== null) {
        const loc = parseInt(m[1], 10);
        if (!seen[loc]) {
            seen[loc] = true;
            keyLocations.push(loc);
        }
    }

    let imgList = imageList;
    try {
        const unscrambleKey = keyLocations.map(loc => {
            const c = imgList[loc];
            const n = parseInt(c, 10);
            if (isNaN(n)) throw new Error("NaN at " + loc);
            return n;
        });
        keyLocations.forEach((loc, idx) => {
            const pos = loc - idx;
            imgList = imgList.slice(0, pos) + imgList.slice(pos + 1);
        });
        imgList = unscrambleString(imgList, unscrambleKey);
    } catch (e) {
        // List was already unscrambled.
    }
    return imgList;
}

function unscrambleString(s, keys) {
    const arr = s.split('');
    const reversed = keys.slice().reverse();
    for (const k of reversed) {
        for (let i = arr.length - 1; i >= k; i--) {
            if (i % 2 !== 0) {
                const temp = arr[i - k];
                arr[i - k] = arr[i];
                arr[i] = temp;
            }
        }
    }
    return arr.join('');
}

function computeDescKey(imgKeys, url) {
    try {
        const body = "function replacePos(strObj, pos, replacetext) {"
            + "return strObj.substr(0,pos)+replacetext+strObj.substring(pos+1,strObj.length);}"
            + "var width=0,height=0,id='';" + imgKeys
            + ";return typeof key !== 'undefined' ? key : '';";
        const fn = new Function("url", body);
        const k = fn(url);
        return k || "";
    } catch (e) {
        return "";
    }
}

// Expose the six host entry points on globalThis. QuickJS evaluates scripts at the top
// level of the global scope, so bare `async function` declarations would normally end up
// on globalThis — but once this file goes through esbuild's CJS bundle, the whole module
// is wrapped in an IIFE and those declarations become module-local. Assigning them here
// has the side effect that keeps them from being tree-shaken, and puts them where the
// host looks for them.
globalThis.getPopularManga  = getPopularManga;
globalThis.getLatestManga   = getLatestManga;
globalThis.searchManga      = searchManga;
globalThis.getMangaDetails  = getMangaDetails;
globalThis.getChapterList   = getChapterList;
globalThis.getPageList      = getPageList;
