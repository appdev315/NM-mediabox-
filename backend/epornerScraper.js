import axios from 'axios';

class EpornerScraper {
    async search(query = '', page = 0) {
        try {
            const epPage = (page || 0) + 1;
            const searchQ = query ? encodeURIComponent(query) : 'popular';
            const url = `https://www.eporner.com/api/v2/video/search/?query=${searchQ}&per_page=30&page=${epPage}&thumbsize=big`;
            
            const res = await axios.get(url, { timeout: 8000 });
            
            if (!res.data || !res.data.videos) return [];
            
            return res.data.videos.map(v => ({
                id: `eporner_${v.id}`,
                title: v.title,
                poster: v.default_thumb?.src || '',
                duration: v.length_min || '',
                type: 'adult',
                href: v.url
            }));
        } catch (error) {
            console.error('[EpornerScraper] Search error:', error.message);
            return [];
        }
    }

    async getVideoDetails(id) {
        try {
            // Remove the eporner_ prefix
            const realId = id.replace('eporner_', '');
            return {
                iframe: `https://www.eporner.com/embed/${realId}/`,
                mp4: null
            };
        } catch (error) {
            console.error('[EpornerScraper] Detail error:', error.message);
            return null;
        }
    }
}

export default new EpornerScraper();
