const axios = require("axios");

const MANGADEX_API = "https://api.mangadex.org";

/**
 * Extracts the manga ID from a MangaDex manga URL.
 * Expected format: https://mangadex.org/title/{id}/...
 * @param {string} url
 * @returns {string} manga ID
 */
function extractMangaId(url) {
  const match = url.match(/mangadex\.org\/title\/([^/?#]+)/);
  if (!match) {
    throw new Error(`Could not extract manga ID from URL: ${url}`);
  }
  return match[1];
}

/**
 * Extracts the chapter ID from a MangaDex chapter URL.
 * Expected format: https://mangadex.org/chapter/{id}/...
 * @param {string} url
 * @returns {string} chapter ID
 */
function extractChapterId(url) {
  const match = url.match(/mangadex\.org\/chapter\/([^/?#]+)/);
  if (!match) {
    throw new Error(`Could not extract chapter ID from URL: ${url}`);
  }
  return match[1];
}

/**
 * Fetches details for a manga given its MangaDex URL.
 * @param {string} url - MangaDex manga URL (e.g. https://mangadex.org/title/{id})
 * @returns {Promise<Object>} manga details object
 */
async function getMangaDetails(url) {
  const mangaId = extractMangaId(url);
  const response = await axios.get(`${MANGADEX_API}/manga/${mangaId}`, {
    params: {
      includes: ["author", "artist", "cover_art"],
    },
  });
  return response.data.data;
}

/**
 * Fetches the chapter list for a manga given its MangaDex URL.
 * @param {string} url - MangaDex manga URL (e.g. https://mangadex.org/title/{id})
 * @returns {Promise<Array>} array of chapter objects
 */
async function getChapterList(url) {
  const mangaId = extractMangaId(url);
  const limit = 100;
  let offset = 0;
  let chapters = [];
  let total = null;

  do {
    const response = await axios.get(`${MANGADEX_API}/manga/${mangaId}/feed`, {
      params: {
        limit,
        offset,
        translatedLanguage: ["en"],
        order: { chapter: "asc" },
      },
    });
    const data = response.data;
    chapters = chapters.concat(data.data);
    total = data.total;
    offset += limit;
  } while (offset < total);

  return chapters;
}

/**
 * Fetches the page image URLs for a chapter given its MangaDex URL.
 * @param {string} url - MangaDex chapter URL (e.g. https://mangadex.org/chapter/{id})
 * @returns {Promise<Array<string>>} array of page image URLs
 */
async function getPageList(url) {
  const chapterId = extractChapterId(url);
  const response = await axios.get(
    `${MANGADEX_API}/at-home/server/${chapterId}`
  );
  const { baseUrl, chapter } = response.data;
  const { hash, data: pages } = chapter;
  return pages.map((page) => `${baseUrl}/data/${hash}/${page}`);
}

/**
 * Searches for manga on MangaDex by query string.
 * @param {string} query - Search query
 * @param {number} [page=1] - Page number (1-based)
 * @returns {Promise<Object>} search results containing data array and total count
 */
async function searchManga(query, page = 1) {
  const limit = 20;
  const offset = (page - 1) * limit;
  const response = await axios.get(`${MANGADEX_API}/manga`, {
    params: {
      title: query,
      limit,
      offset,
      includes: ["cover_art"],
      order: { relevance: "desc" },
    },
  });
  return response.data;
}

module.exports = { getMangaDetails, getChapterList, getPageList, searchManga };
