import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://kinovasek.net';

export async function getLatestDownloads(page = 1) {
    try {
        const url = page === 1 ? BASE_URL : `${BASE_URL}/page/${page}/`;
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
        });
        return parseCards(res.data);
    } catch (e) {
        console.error('Error fetching latest downloads:', e.message);
        return [];
    }
}

export async function searchDownloads(query) {
    try {
        const params = new URLSearchParams();
        params.append('do', 'search');
        params.append('subaction', 'search');
        params.append('story', query);
        
        const res = await axios.post(`${BASE_URL}/index.php?do=search`, params.toString(), {
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' 
            }
        });
        return parseCards(res.data);
    } catch (e) {
        console.error('Error searching downloads:', e.message);
        return [];
    }
}

export async function getDownloadLinks(url) {
    try {
        const res = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }
        });
        const $ = cheerio.load(res.data);
        const links = [];
        
        $('.v_links a').each((i, el) => {
            const encodedUrl = $(el).attr('href');
            if (encodedUrl && encodedUrl.includes('url=')) {
                try {
                    const base64Str = encodedUrl.split('url=')[1];
                    const decodedUrl = Buffer.from(base64Str, 'base64').toString('utf8');
                    const text = $(el).text();
                    
                    let quality = 'SD';
                    let size = '';
                    
                    const spanText = $(el).find('span').text() || '';
                    if (spanText.includes('1080')) quality = '1080p';
                    else if (spanText.includes('720')) quality = '720p';
                    else if (spanText.includes('640') || spanText.includes('480')) quality = '480p';
                    else if (spanText.includes('320')) quality = '360p';
                    
                    const matchSize = text.match(/Скачать - ([\d.]+ мб)/i);
                    if (matchSize) size = matchSize[1];
                    
                    links.push({
                        quality,
                        size,
                        url: decodedUrl
                    });
                } catch(e) {}
            }
        });
        
        // Also extract some info for the modal
        const title = $('.zhir_nz strong').text().trim() || $('h1').text().trim();
        const poster = BASE_URL + $('.shfilm img').attr('src'); // Might need adjustment for single page
        
        return {
            title,
            links
        };
    } catch (e) {
        console.error('Error getting download links:', e.message);
        return { links: [] };
    }
}

function parseCards(html) {
    const $ = cheerio.load(html);
    return $('.shfilm').map((i, el) => {
        const $el = $(el);
        const url = $el.attr('href');
        if (!url) return null;
        
        let poster = $el.find('img').attr('src') || $el.find('img').attr('data-src') || '';
        if (poster && !poster.startsWith('http')) {
            poster = BASE_URL + poster;
        }
        
        return {
            id: Buffer.from(url).toString('base64'),
            url,
            title: $el.find('.shfiltitle span:first-child').text().trim(),
            poster,
            info: $el.find('.shfilinfo').text().trim(),
            rating: $el.find('.rateshot').text().trim()
        };
    }).get().filter(Boolean);
}
