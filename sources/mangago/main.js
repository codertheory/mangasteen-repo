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
function defaultHeaders() {
    return {
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

// Returns Unix epoch milliseconds as a number, or 0 if the input can't be parsed.
// The host decodes these into a Long — mixing "" with numeric strings breaks decoding,
// so always return a number.
function parseMangagoDate(dateStr) {
    if (!dateStr) return 0;
    const m = dateStr.match(/([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
    if (m) {
        const month = MONTHS[m[1].toLowerCase()];
        const day = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);
        if (month !== undefined && !isNaN(day) && !isNaN(year)) {
            return new Date(year, month, day).getTime();
        }
    }
    return 0;
}

function parseChapters(html) {
    const rows = ksoupSelect(html, "table#chapter_table > tbody > tr, table.uk-table > tbody > tr");
    const chapters = [];
    for (const row of rows) {
        const linkEl = ksoupSelect(row.outerHtml, "a.chico")[0];
        if (!linkEl) continue;
        const chapterUrl = absolutize(linkEl.attr["href"] || "");
        const name = linkEl.text.trim();

        const tds = ksoupSelect(row.outerHtml, "td");
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
        return await getChapterImageUrls(response.body);
    } catch (error) {
        console.log("Error getting page list: " + error);
        return [];
    }
}

async function getChapterImageUrls(html) {
    const imgsrcsMatch = html.match(/var\s+imgsrcs\s*=\s*['"]([a-zA-Z0-9+=/]+)['"]/);
    if (!imgsrcsMatch) throw new Error("imgsrcs script not found");

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
    const decrypted = crypto.aesCbcDecrypt(keyHex, ivHex, imgsrcsMatch[1], "none");
    let imageList = decrypted.replace(/\x00+$/, "");

    imageList = unscrambleImageList(imageList, chapterJs);

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

    return imageList.split(",").map(rawUrl => {
        const u = rawUrl.trim();
        if (u.indexOf("cspiclink") >= 0 && imgKeys) {
            const descKey = computeDescKey(imgKeys, u);
            if (descKey) return u + "#descrambler=mangago&desckey=" + descKey + "&cols=" + cols;
        }
        return u;
    });
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
