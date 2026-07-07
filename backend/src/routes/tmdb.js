import express from 'express';
import axios from 'axios';
import { withMovieCache } from '../utils/cache.js';

export const tmdbRouter = express.Router();
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'cd5b69242e715dc87d65957d7460eba2';

tmdbRouter.get('/api/tmdb/*', async (req, res) => {
    const endpoint = req.params[0];
    const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
    
    for (const [key, value] of Object.entries(req.query)) {
        url.searchParams.append(key, value);
    }
    url.searchParams.set('api_key', TMDB_API_KEY);

    const cacheKey = `tmdb_${url.toString()}`;
    const ttl = url.pathname.includes('/search') ? 7200 : 86400; 
    
    try {
        const data = await withMovieCache(cacheKey, ttl, async () => {
            let attempt = 0;
            while (attempt < 3) {
                try {
                    const response = await axios.get(url.toString(), { timeout: 10000 });
                    return response.data;
                } catch (err) {
                    attempt++;
                    console.error(`[TMDB] Fetch attempt ${attempt} failed for ${url.toString()}:`, err.message);
                    if (attempt >= 3) throw err;
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        });
        res.json(data);
    } catch (e) {
        console.error(`[TMDB] Final error fetching ${url.toString()}:`, e.message);
        res.status(e.response?.status || 500).json({ error: e.message });
    }
});
