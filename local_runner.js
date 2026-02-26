const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// 1. Mock httpGet
globalThis.httpGet = async function(url) {
    try {
        console.log("Fetching: " + url);
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        console.error("Error in httpGet:", error.message);
        throw error;
    }
};

// 2. Mock ksoupSelect
// Ksoup maps to Jsoup/Cheerio
globalThis.ksoupSelect = function(html, selector) {
    const $ = cheerio.load(html, { xmlMode: false, decodeEntities: false }, false); // Use false as 3rd arg to avoid adding html/body tags if fragment
    // However, cheerio.load(html) always returns a function that queries.
    // ksoupSelect expects to query 'html' string.

    // If html is a fragment, Cheerio handles it.

    const elements = $(selector);
    const results = [];

    elements.each((index, element) => {
        const el = $(element);

        // Helper to get attributes
        const attr = {};
        if (element.attribs) {
            for (const key in element.attribs) {
                attr[key] = element.attribs[key];
            }
        }

        results.push({
            text: el.text(),
            outerHtml: $.html(element),
            innerHtml: el.html(),
            attr: attr
        });
    });

    return results;
};

// 3. Load and execute the main.js script
const mainJsPath = path.join(__dirname, 'sources/mangaKatana/main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

// We use eval to execute the script in the global scope so functions become available
// Note: In a real production app we might use vm.runInThisContext, but eval is simple for this runner.
eval(mainJsContent);

// 4. Run tests
(async () => {
    try {
        console.log("--- Testing getPopularManga ---");
        const popular = await getPopularManga();
        console.log("Found " + popular.length + " popular manga.");
        if (popular.length > 0) {
            console.log("First item:", popular[0]);
        }

        console.log("\n--- Testing getLatestManga ---");
        const latest = await getLatestManga();
        console.log("Found " + latest.length + " latest manga.");
        if (latest.length > 0) {
            console.log("First item:", latest[0]);
        }

        // Pick one manga to test details and chapters
        let mangaUrl = "";
        if (popular.length > 0) {
            mangaUrl = popular[0].url;
        } else if (latest.length > 0) {
            mangaUrl = latest[0].url;
        }

        if (mangaUrl) {
            console.log("\n--- Testing getMangaDetails ---");
            const details = await getMangaDetails(mangaUrl);
            console.log("Details:", details);

            console.log("\n--- Testing getChapterList ---");
            const chapters = await getChapterList(mangaUrl);
            console.log("Found " + chapters.length + " chapters.");

            if (chapters.length > 0) {
                console.log("First chapter:", chapters[0]);

                const chapterUrl = chapters[0].url;
                console.log("\n--- Testing getPageList for chapter: " + chapterUrl + " ---");

                const pages = await getPageList(chapterUrl);
                if (pages && pages.length > 0) {
                     console.log("Found " + pages.length + " pages.");
                     console.log("First page:", pages[0]);
                } else {
                    console.log("No pages found. This might be due to regex mismatch or website changes.");
                }
            }
        }

        console.log("\n--- Testing searchManga ---");
        const searchResults = await searchManga("piece", 1);
        console.log("Found " + searchResults.length + " search results.");
        if (searchResults.length > 0) {
            console.log("First result:", searchResults[0]);
        }
    } catch (e) {
        console.error("Runner failed:", e);
    }

})();



