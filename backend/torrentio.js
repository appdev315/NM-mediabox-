import axios from 'axios';

class Torrentio {
    constructor() {
        this.baseUrl = 'https://torrentio.strem.fun';
    }

    async getStreams(imdbId, type = 'movie') {
        try {
            // type can be 'movie' or 'series'
            // For series, imdbId should be formatted as tt1234567:season:episode
            const url = `${this.baseUrl}/stream/${type}/${imdbId}.json`;
            const res = await axios.get(url, { timeout: 10000 });
            return res.data.streams || [];
        } catch (error) {
            console.error('[Torrentio] Error fetching streams:', error.message);
            return [];
        }
    }

    async getBestRussianMagnet(imdbId, type = 'movie') {
        const streams = await this.getStreams(imdbId, type);
        if (streams.length === 0) return null;

        // Try to find a stream with Russian language / dubbing
        // Torrentio often labels these with 🇷🇺 in the title or "Rus"
        let bestStream = streams.find(s => s.title && (s.title.includes('🇷🇺') || s.title.toLowerCase().includes('rus')));

        // If no Russian stream found, fallback to the first (most seeded) stream which is usually high quality English
        if (!bestStream) {
            bestStream = streams[0];
        }

        if (!bestStream) return null;

        // Extract magnet from infoHash and trackers, or directly from infoHash
        // Torrentio sometimes returns infoHash instead of url.
        if (bestStream.url) {
            return bestStream.url; // Often it's a direct magnet URL
        } else if (bestStream.infoHash) {
            // Construct magnet link manually
            let magnet = `magnet:?xt=urn:btih:${bestStream.infoHash}`;
            if (bestStream.title) {
                const name = encodeURIComponent(bestStream.title.split('\n')[0]);
                magnet += `&dn=${name}`;
            }
            if (bestStream.sources) {
                bestStream.sources.forEach(src => {
                    if (src.startsWith('tracker:')) {
                        magnet += `&tr=${encodeURIComponent(src.replace('tracker:', ''))}`;
                    }
                });
            }
            return magnet;
        }

        return null;
    }
}

export default new Torrentio();
