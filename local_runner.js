const axios = require('axios');
const cheerio = require('cheerio');
const nodeCrypto = require('node:crypto');
const fs = require('fs');
const path = require('path');

// CLI: node local_runner.js [sourceName] [testName] [--fixtures]
//   sourceName — folder under sources/ (default: mangaKatana)
//   testName   — optional; runs just this entry from fixtures/tests.json
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const SOURCE = positional[0] || 'mangaKatana';
const TEST_FILTER = positional[1] || '';
const OFFLINE = flags.has('--fixtures');
const FIXTURES_DIR = path.join(__dirname, 'sources', SOURCE, 'fixtures');

// Load the source's extension.json so we can mirror the host's hostAllowlist firewall
// locally. Missing manifest or empty list → no enforcement (trust-mode), same as the host.
const MANIFEST_PATH = path.join(__dirname, 'sources', SOURCE, 'extension.json');
let HOST_ALLOWLIST = [];
if (fs.existsSync(MANIFEST_PATH)) {
    try {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        if (Array.isArray(manifest.hostAllowlist)) HOST_ALLOWLIST = manifest.hostAllowlist;
    } catch (e) {
        console.error(`Invalid ${MANIFEST_PATH}:`, e.message);
    }
}

function hostAllowed(urlStr) {
    if (HOST_ALLOWLIST.length === 0) return true;
    let host;
    try { host = new URL(urlStr).hostname; } catch (_) { return false; }
    return HOST_ALLOWLIST.some(entry => {
        if (entry.startsWith('.')) {
            const suffix = entry.slice(1);
            return host === suffix || host.endsWith(entry);
        }
        return host === entry;
    });
}

function loadFixtureEntries() {
    const manifestPath = path.join(FIXTURES_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return [];
    try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (e) { console.error('Invalid fixtures/manifest.json:', e.message); return []; }
}
const fixtureEntries = OFFLINE ? loadFixtureEntries() : [];

// Build the effective URL for a (url, options) pair — axios appends options.params
// to the querystring, so we need the same rolled-up string for fixture matching.
function effectiveUrl(url, options) {
    if (!options || !options.params) return url;
    try {
        const u = new URL(url);
        for (const [k, v] of Object.entries(options.params)) u.searchParams.set(k, String(v));
        return u.toString();
    } catch (_) { return url; }
}

// Canonical URL equality: same origin + path, same params regardless of order.
// Lets fixture manifests stay readable (params order doesn't matter, `+` vs `%20`
// doesn't matter) while still being strict about which request matches which response.
function sameUrl(a, b) {
    try {
        const ua = new URL(a);
        const ub = new URL(b);
        if (ua.origin !== ub.origin || ua.pathname !== ub.pathname) return false;
        const canon = (u) => [...u.searchParams].sort().map(([k, v]) => `${k}=${v}`).join('&');
        return canon(ua) === canon(ub);
    } catch (_) { return a === b; }
}

// 1. Mock httpGet
// Local cookie jar — mirrors what the native host does per-source. Lets scrapers that
// depend on auth cookies (login, CSRF tokens, etc.) be exercised end-to-end from the CLI.
const localCookieJar = new Map(); // host -> { name -> value }
function readCookieHeader(url) {
    try {
        const { host } = new URL(url);
        const jar = localCookieJar.get(host);
        if (!jar || jar.size === 0) return null;
        return Array.from(jar.entries()).map(([n, v]) => `${n}=${v}`).join('; ');
    } catch (_) { return null; }
}
function persistSetCookies(url, setCookieHeaders) {
    if (!setCookieHeaders) return;
    try {
        const { host } = new URL(url);
        let jar = localCookieJar.get(host);
        if (!jar) { jar = new Map(); localCookieJar.set(host, jar); }
        const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        for (const h of headers) {
            const first = h.split(';', 1)[0];
            const eq = first.indexOf('=');
            if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
        }
    } catch (_) {}
}

globalThis.httpGet = async function(url, options) {
    if (!hostAllowed(url)) {
        throw new Error(
            `Host not allowed: ${url}. Add its host to extension.json#hostAllowlist ` +
            `(or clear the list to disable enforcement).`
        );
    }
    if (OFFLINE) {
        const requestMethod = (options && options.method ? options.method : 'GET').toUpperCase();
        const effective = effectiveUrl(url, options);
        const methodMatch = (entry) => (entry.method || 'GET').toUpperCase() === requestMethod;
        // Prefer a fixture whose URL includes the full querystring (lets mangaKatana-style
        // sources distinguish search vs homepage on the same path). Fall back to the bare
        // URL so mangago-style manifests (param-free entries) keep working.
        const match = fixtureEntries.find(e => methodMatch(e) && sameUrl(e.url, effective))
            ?? fixtureEntries.find(e => methodMatch(e) && sameUrl(e.url, url));
        if (!match) {
            console.error(`No fixture for ${effective}. Add one to sources/${SOURCE}/fixtures/manifest.json.`);
            return { body: '', url: effective, status: 404 };
        }
        const body = fs.readFileSync(path.join(FIXTURES_DIR, match.response), 'utf8');
        return { body, url: effective, status: match.status || 200 };
    }
    try {
        console.log("Fetching: " + url + (options ? " with options: " + JSON.stringify(options) : ""));
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        };
        // Merge options.headers if present
        if (options && options.headers) {
            Object.assign(headers, options.headers);
        }
        // Auto-inject stored cookies unless the caller already set Cookie
        const hasCookie = Object.keys(headers).some(k => k.toLowerCase() === 'cookie');
        if (!hasCookie) {
            const cookieHeader = readCookieHeader(url);
            if (cookieHeader) headers['Cookie'] = cookieHeader;
        }

        const config = { headers };
        if (options && options.params) {
            config.params = options.params;
        }

        const response = await axios.get(url, config);
        // Persist Set-Cookie for this host
        const setCookie = response.headers && (response.headers['set-cookie'] || response.headers['Set-Cookie']);
        if (setCookie) persistSetCookies(response.config.url ?? url, setCookie);
        return {
            body: (typeof response.data === 'object') ? JSON.stringify(response.data) : String(response.data),
            url: response.config.url ?? url,
            status: response.status
        };
    } catch (error) {
        console.error("Error in httpGet:", error.message);
        throw error;
    }
};

// 1b. Mock globalThis.crypto (mirrors dev.codertheory.data.js.JsCrypto bindings).
// Node 19+ defines globalThis.crypto as a read-only Web Crypto getter, so a bare
// assignment silently fails; defineProperty is required to replace it.
Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: {
    sha1:   (s) => nodeCrypto.createHash('sha1').update(String(s), 'utf8').digest('hex'),
    sha256: (s) => nodeCrypto.createHash('sha256').update(String(s), 'utf8').digest('hex'),
    sha512: (s) => nodeCrypto.createHash('sha512').update(String(s), 'utf8').digest('hex'),
    hmacSha256: (keyHex, msg) =>
        nodeCrypto.createHmac('sha256', Buffer.from(String(keyHex), 'hex')).update(String(msg), 'utf8').digest('hex'),
    hmacSha256FromUtf8: (key, msg) =>
        nodeCrypto.createHmac('sha256', String(key)).update(String(msg), 'utf8').digest('hex'),
    base64Encode: (s) => Buffer.from(String(s), 'utf8').toString('base64'),
    base64Decode: (s) => Buffer.from(String(s), 'base64').toString('utf8'),
    aesCbcDecrypt: (keyHex, ivHex, base64Cipher, padding = 'pkcs7') => {
        const keyBuf = Buffer.from(String(keyHex), 'hex');
        const ivBuf = Buffer.from(String(ivHex), 'hex');
        const algorithm =
            keyBuf.length === 16 ? 'aes-128-cbc' :
            keyBuf.length === 24 ? 'aes-192-cbc' :
            keyBuf.length === 32 ? 'aes-256-cbc' :
            (() => { throw new Error(`aesCbcDecrypt: key must be 16/24/32 bytes, got ${keyBuf.length}`); })();
        if (padding !== 'pkcs7' && padding !== 'none') {
            throw new Error(`aesCbcDecrypt: padding must be "pkcs7" or "none", got "${padding}"`);
        }
        const decipher = nodeCrypto.createDecipheriv(algorithm, keyBuf, ivBuf);
        if (padding === 'none') decipher.setAutoPadding(false);
        const ct = Buffer.from(String(base64Cipher), 'base64');
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    },
}});

// 1c. Mock globalThis.clearCookies (per-source cookie clear; local impl clears all)
globalThis.clearCookies = async function() {
    localCookieJar.clear();
};

// Signal fixture mode to sources so parsers that derive values from wall-clock time
// (e.g. "2 days ago" → Date.now() − 2d) can skip that work. Captured HTML freezes
// relative strings, so live parsing would make the computed timestamp drift forward
// every test run and break any future golden-compare. Sources treat this as advisory.
globalThis.OFFLINE = OFFLINE;

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

// 3. Load and execute the chosen source.
//    Sources are single-file by default (`main.js`). If a source ever needs a bundled npm
//    package (`require('foo')` doesn't exist in QuickJS), keep the editable code at
//    `main.src.js`, produce `main.js` via esbuild, and the runner will load the pre-bundle
//    source here so edits work without a rebuild.
const srcPath = path.join(__dirname, 'sources', SOURCE, 'main.src.js');
const builtPath = path.join(__dirname, 'sources', SOURCE, 'main.js');
const mainJsPath = fs.existsSync(srcPath) ? srcPath : builtPath;
if (!fs.existsSync(mainJsPath)) {
    console.error(`Source not found: ${builtPath}`);
    process.exit(1);
}
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

// Indirect eval runs the source at global scope, so bare `function foo()` declarations
// (e.g. mangaKatana's style) become globalThis.foo — matching how QuickJS evaluates the
// script in production. Sources that wrap themselves in an IIFE (e.g. bundled mangago)
// assign to globalThis explicitly; both paths converge on globalThis.<entryPoint>.
(0, eval)(mainJsContent);

// 4. Run tests — driven by sources/<name>/fixtures/tests.json.
// Each entry: { name, function, args }. Golden output (optional) at expected/<name>.json
// is compared when present; missing gold files are treated as "no opinion", not a failure.
function summarize(name, result) {
    console.log(`\n--- ${name} ---`);
    if (Array.isArray(result)) {
        console.log(`Found ${result.length} ${result.length === 1 ? 'item' : 'items'}.`);
        if (result.length > 0) console.log('First item:', result[0]);
    } else {
        console.log('Result:', result);
    }
}

function goldenCompare(name, result) {
    const goldenPath = path.join(FIXTURES_DIR, 'expected', `${name}.json`);
    if (!fs.existsSync(goldenPath)) return null;
    const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
    const actual = JSON.parse(JSON.stringify(result));
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(ok ? `  golden: OK` : `  golden: DIFF vs expected/${name}.json`);
    return ok;
}

(async () => {
    const testsPath = path.join(FIXTURES_DIR, 'tests.json');
    if (!fs.existsSync(testsPath)) {
        console.error(`No tests.json at ${testsPath}.\n` +
            `Add one shaped as [{ "name": "...", "function": "getPopularManga", "args": [1] }].`);
        process.exit(1);
    }
    const tests = JSON.parse(fs.readFileSync(testsPath, 'utf8'));
    const selected = TEST_FILTER ? tests.filter(t => t.name === TEST_FILTER) : tests;
    if (selected.length === 0) {
        console.error(`No test named "${TEST_FILTER}" in ${testsPath}`);
        process.exit(1);
    }

    console.log(`\n=== Running ${selected.length} test(s) for source: ${SOURCE}${OFFLINE ? ' [offline]' : ' [live]'} ===`);
    let failed = 0;
    for (const t of selected) {
        const fn = globalThis[t.function];
        if (typeof fn !== 'function') {
            console.error(`\n--- ${t.name} ---\nUnknown function: ${t.function}`);
            failed++;
            continue;
        }
        try {
            const result = await fn(...(t.args || []));
            summarize(t.name, result);
            if (goldenCompare(t.name, result) === false) failed++;
        } catch (e) {
            console.error(`\n--- ${t.name} --- FAILED: ${e.message}`);
            failed++;
        }
    }
    if (failed > 0) {
        console.error(`\n${failed} test(s) failed.`);
        process.exit(1);
    }
})();
