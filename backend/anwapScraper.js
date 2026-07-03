import axios from 'axios';
import * as cheerio from 'cheerio';

const MIRRORS = [
    'https://mm.anwap.media',
    'https://anwap.tube',
    'https://anwap.pm',
    'https://anwap.bio'
];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];

function getRandomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Fetch a page from Anwap mirrors using axios+cheerio.
 * Handles JavaScript-based redirect pages by extracting the redirect URL from the HTML.
 * Falls back across mirrors on failure.
 */
async function fetchWithFallback(path, maxRetries = 2) {
    for (const mirror of MIRRORS) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const url = `${mirror}${path}`;
                console.log(`[Anwap] Trying ${url} (attempt ${attempt + 1})`);

                const res = await axios.get(url, {
                    timeout: 10000,
                    headers: {
                        'User-Agent': getRandomUA(),
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
                        'Referer': mirror + '/'
                    },
                    maxRedirects: 5,
                    validateStatus: (status) => status < 400
                });

                const html = res.data;

                // Check if we got a JS redirect page instead of real content
                if (typeof html === 'string' && html.includes('redirect_link =')) {
                    // Extract redirect URL from JavaScript: var redirect_link = "...";
                    const redirectMatch = html.match(/redirect_link\s*=\s*["']([^"']+)["']/);
                    if (redirectMatch) {
                        const redirectUrl = redirectMatch[1].startsWith('http')
                            ? redirectMatch[1]
                            : `${mirror}${redirectMatch[1]}`;

                        console.log(`[Anwap] Following JS redirect to: ${redirectUrl}`);
                        const redirectRes = await axios.get(redirectUrl, {
                            timeout: 10000,
                            headers: {
                                'User-Agent': getRandomUA(),
                                'Referer': url
                            },
                            maxRedirects: 5
                        });
                        return { data: redirectRes.data, baseUrl: mirror };
                    }
                }

                // Check if we got real content (has expected HTML structure)
                if (typeof html === 'string' && html.length > 500) {
                    return { data: html, baseUrl: mirror };
                }

                throw new Error('Empty or invalid response');
            } catch (e) {
                console.log(`[Anwap] Mirror ${mirror} attempt ${attempt + 1} failed: ${e.message}`);
                if (attempt < maxRetries) {
                    // Small delay before retry
                    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                }
            }
        }
    }
    throw new Error('All Anwap mirrors failed');
}

export async function getAnwapDownloadInfo(title, isTv) {
    // Search
    const searchRes = await fetchWithFallback(`/search?search=${encodeURIComponent(title)}`);
    const $ = cheerio.load(searchRes.data);
    const baseUrl = searchRes.baseUrl;

    let targetLink = null;
    $('.block .block a').each((i, el) => {
        const link = $(el).attr('href');
        const text = $(el).text().trim().toLowerCase();
        // Check if it matches title and type
        if (link) {
            if (isTv && link.startsWith('/serials/')) {
                // simple fuzzy match
                if (text.includes(title.toLowerCase())) targetLink = link;
            } else if (!isTv && link.startsWith('/films/')) {
                if (text.includes(title.toLowerCase())) targetLink = link;
            }
            if (!targetLink && link.startsWith(isTv ? '/serials/' : '/films/')) {
                targetLink = link; // Fallback to first result of correct type
            }
        }
    });

    if (!targetLink) {
        throw new Error('Title not found on Anwap');
    }

    // Fetch Details Page
    const detailRes = await fetchWithFallback(targetLink);
    const $d = cheerio.load(detailRes.data);

    if (isTv) {
        // Parse Seasons and Episodes
        const seasons = [];
        // Anwap serials usually have links to seasons or episodes
        $d('.block a').each((i, el) => {
            const href = $d(el).attr('href');
            const text = $d(el).text().trim();
            if (href && href.includes('/serials/')) {
                seasons.push({ text, href: `${baseUrl}${href}` });
            }
        });
        
        // Sometimes it links to episodes directly if it's a 1-season show
        return { type: 'series', title, items: seasons, sourceUrl: `${baseUrl}${targetLink}` };
    } else {
        // Parse Movie Download links
        const downloads = [];
        $d('a').each((i, el) => {
            const href = $d(el).attr('href');
            const text = $d(el).text().trim();
            if (href && (text.includes('Скачать MP4') || text.includes('Скачать 3GP'))) {
                downloads.push({ text, href: `${baseUrl}${href}` });
            }
        });
        
        if (downloads.length === 0) {
            throw new Error('No download links found for movie');
        }
        
        // Pick the highest quality (usually the last MP4)
        const bestDownload = downloads[downloads.length - 1];
        return { type: 'movie', title, downloadUrl: bestDownload.href };
    }
}

export async function getAnwapSeriesLink(episodeUrl) {
    try {
        const urlObj = new URL(episodeUrl);
        const path = urlObj.pathname + urlObj.search;
        const res = await fetchWithFallback(path);
        const $d = cheerio.load(res.data);
        
        // Check if there are download links
        const downloads = [];
        $d('a').each((i, el) => {
            const href = $d(el).attr('href');
            const text = $d(el).text().trim();
            if (href && (text.includes('Скачать MP4') || text.includes('Скачать 3GP'))) {
                downloads.push({ text, href: `${res.baseUrl}${href}` });
            }
        });
        
        if (downloads.length > 0) {
            // It's an episode page with downloads
            return { type: 'episode_download', downloadUrl: downloads[downloads.length - 1].href };
        }
        
        // Otherwise it might be a Season page containing episodes
        const episodes = [];
        $d('.block a').each((i, el) => {
            const href = $d(el).attr('href');
            const text = $d(el).text().trim();
            if (href && href.includes('/serials/')) {
                episodes.push({ text, href: `${res.baseUrl}${href}` });
            }
        });
        
        return { type: 'season_episodes', items: episodes };
        
    } catch (e) {
        throw new Error('Failed to fetch series link: ' + e.message);
    }
}
