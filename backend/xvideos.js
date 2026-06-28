import axios from 'axios';
import * as cheerio from 'cheerio';

class XvideosScraper {
    constructor() {
        this.baseUrl = 'https://www.xvideos.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': 'lang=english'
        };
    }

    async search(query = '', page = 0) {
        try {
            // URL format: https://xv-ru.com/?k=query&p=page
            // Home page: https://xv-ru.com/
            let url = this.baseUrl;
            if (query) {
                url += `/?k=${encodeURIComponent(query)}&p=${page}`;
            } else if (page > 0) {
                url += `/new/${page}/`;
            }

            const res = await axios.get(url, { headers: this.headers, timeout: 8000 });
            const $ = cheerio.load(res.data);
            const videos = [];

            $('.mozaique .thumb-block').each((i, el) => {
                const titleNode = $(el).find('p.title a');
                let title = titleNode.text().trim() || $(el).find('a').attr('title');
                
                // Clean up title (remove "XX мин." at the end if present)
                if (title) {
                    title = title.replace(/\s*\d+\s*(мин\.|sec\.|min\.)/i, '').trim();
                }

                const href = $(el).find('a').attr('href');
                let img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
                if (img && img.includes('THUMBNUM')) {
                    img = img.replace('THUMBNUM', '1');
                }
                
                // Duration
                const duration = $(el).find('.duration').text().trim();

                if (title && href && img && !href.includes('promo')) {
                    // Xvideos IDs look like /video.ohblphhf4c8/_
                    const idMatch = href.match(/\/video\.([^\/]+)/);
                    const id = idMatch ? idMatch[1] : Buffer.from(href).toString('base64');

                    videos.push({
                        id,
                        title,
                        poster: img,
                        duration,
                        type: 'adult',
                        href
                    });
                }
            });

            return videos;
        } catch (error) {
            console.error('[Xvideos] Search error:', error.message);
            return [];
        }
    }

    async getVideoDetails(hrefOrId) {
        try {
            // Extract the actual ID if it's passed as a full ID string
            let id = hrefOrId;
            if (hrefOrId.startsWith('video.')) {
                id = hrefOrId.split('.')[1];
            } else if (hrefOrId.startsWith('/video.')) {
                const match = hrefOrId.match(/\/video\.([^\/]+)/);
                if (match) id = match[1];
            }
            
            return {
                iframe: `https://www.xvideos.com/embedframe/${id}`,
                mp4: null
            };
        } catch (error) {
            console.error('[Xvideos] Detail error:', error.message);
            return null;
        }
    }
}

export default new XvideosScraper();
