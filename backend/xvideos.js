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
            // Eporner pages start at 1
            const epPage = (page || 0) + 1;
            const searchQ = query ? encodeURIComponent(query) : 'popular';
            const url = `https://www.eporner.com/api/v2/video/search/?query=${searchQ}&per_page=30&page=${epPage}&thumbsize=big`;
            
            const res = await axios.get(url, { headers: this.headers, timeout: 8000 });
            
            if (!res.data || !res.data.videos) return [];
            
            return res.data.videos.map(v => ({
                id: v.id,
                title: v.title,
                poster: v.default_thumb?.src || '',
                duration: v.length_min || '',
                type: 'adult',
                href: v.url
            }));
        } catch (error) {
            console.error('[AdultScraper] Search error:', error.message);
            return [];
        }
    }

    async getVideoDetails(id) {
        try {
            return {
                iframe: `https://www.eporner.com/embed/${id}/`,
                mp4: null
            };
        } catch (error) {
            console.error('[AdultScraper] Detail error:', error.message);
            return null;
        }
    }
}

export default new XvideosScraper();
