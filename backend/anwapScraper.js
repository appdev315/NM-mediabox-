import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

const MIRRORS = [
    'https://mm.anwap.media',
    'https://anwap.tube',
    'https://anwap.pm',
    'https://anwap.bio'
];

async function fetchWithFallback(path) {
    for (const mirror of MIRRORS) {
        let browser = null;
        try {
            const url = `${mirror}${path}`;
            console.log(`[Anwap] Trying with Puppeteer ${url}`);
            
            browser = await puppeteer.launch({ 
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
            });
            const page = await browser.newPage();
            
            // Set User Agent
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Navigate and wait for network to be idle or redirect
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            
            // Wait a bit to ensure fingerprint redirect happens if it's there
            await new Promise(r => setTimeout(r, 2000));
            
            const html = await page.content();
            
            if (!html.includes('redirect_link =')) {
                // Not the redirect page
                await browser.close();
                return { data: html, baseUrl: mirror };
            }
            
            // If it's still on the redirect page, it failed to redirect automatically
            throw new Error('Puppeteer stuck on redirect page');

        } catch (e) {
            console.log(`[Anwap] Mirror ${mirror} failed: ${e.message}`);
            if (browser) await browser.close();
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
    // If the episodeUrl points to a season page, we need to fetch it and get episodes
    // If it points to an episode, we fetch download links
    // This function will just fetch the URL and find the highest quality MP4.
    
    // Sometimes episodeUrl is relative, sometimes absolute. Assume absolute for simplicity if passed from frontend.
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
