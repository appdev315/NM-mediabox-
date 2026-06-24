import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
const port = process.env.PORT || 7860;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Origin', 'Accept']
}));

const MIRRORS = [
    'https://mj.anwap.today',
    'https://mm.anwap.media',
    'https://m.anwap.media',
    'https://anwap.tube',
    'https://anwap.im',
    'https://anwap.bio',
    'https://anwap.site',
    'https://anwap.pm',
    'https://anwap.best'
];

let activeMirror = null;

async function getActiveMirror() {
    if (activeMirror) return activeMirror;
    
    console.log('[Mirrors] Ping all mirrors to find the fastest active one...');
    const promises = MIRRORS.map(async (mirror) => {
        try {
            await axios.get(mirror, { 
                timeout: 3000, 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                validateStatus: (status) => status === 200
            });
            return mirror;
        } catch (e) {
            throw e;
        }
    });

    try {
        activeMirror = await Promise.any(promises);
        console.log(`[Mirrors] Selected active mirror: ${activeMirror}`);
        return activeMirror;
    } catch (e) {
        console.log('[Mirrors] All mirrors failed!');
        return null;
    }
}

app.get('/', (req, res) => res.json({ status: 'OK', message: 'Anwap Video API is running' }));

app.get('/api/test-anwap', async (req, res) => {
    try {
        let result = '';
        for (const mirror of MIRRORS) {
            try {
                const response = await axios.get(mirror, { timeout: 3000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                result += `${mirror}: OK (${response.status})\n`;
            } catch (e) {
                result += `${mirror}: ERROR (${e.message})\n`;
            }
        }
        res.send(result);
    } catch (e) {
        res.send('Error: ' + e.message);
    }
});

const imdbCache = {}; // Simple in-memory cache for TMDB -> IMDb lookups

app.get('/api/stream', async (req, res) => {
    const { title, year, type, tmdb, imdb } = req.query;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    
    console.log(`[Stream API] Search request for: ${title} (${year || 'any year'}) type: ${type} tmdb: ${tmdb || 'none'} imdb: ${imdb || 'none'}`);
    
    try {
        let imdbId = imdb;
        
        if (!imdbId && tmdb) {
            if (imdbCache[tmdb]) {
                imdbId = imdbCache[tmdb];
                console.log(`[Stream API] Found IMDb ID in cache: ${imdbId}`);
            } else {
                console.log(`[Stream API] Attempting to fetch IMDb ID for TMDB: ${tmdb}`);
                const tmdbEndpoint = (type === 'tv' || type === 'series') ? 'tv' : 'movie';
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/${tmdbEndpoint}/${tmdb}/external_ids?api_key=cd5b69242e715dc87d65957d7460eba2`, { timeout: 4000 });
                imdbId = tmdbRes.data?.imdb_id;
                if (imdbId) {
                    imdbCache[tmdb] = imdbId; // Save to cache
                }
            }
        }

        if (imdbId) {
            console.log(`[Stream API] Found IMDb ID: ${imdbId}, returning native Anwap player (ortified.ws)!`);
            return res.json({ iframe: `https://api.ortified.ws/embed/imdb/${imdbId}` });
        } else {
            console.log(`[Stream API] No IMDb ID found. Falling back to vidsrc.me for TMDB: ${tmdb}`);
            if (tmdb) {
                const fallbackUrl = (type === 'tv' || type === 'series') 
                    ? `https://vidsrc.me/embed/tv?tmdb=${tmdb}`
                    : `https://vidsrc.me/embed/movie?tmdb=${tmdb}`;
                return res.json({ iframe: fallbackUrl });
            }
            return res.status(404).json({ error: 'Not found' });
        }
    } catch (e) {
        console.log(`[Stream API] Failed to resolve stream: ${e.message}`);
        return res.status(500).json({ error: e.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port} with Anwap Smart Mirror selector`);
});
