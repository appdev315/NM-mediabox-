import express from 'express';
import axios from 'axios';
import { proxyLimiter } from '../middlewares/rateLimiter.js';

export const streamRouter = express.Router();
const imdbCache = {};

function isAllowedProxyUrl(urlStr) {
    try {
        const parsed = new URL(urlStr);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
        if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('0.')) return false;
        if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
        if (host.startsWith('169.254.')) return false;
        return true;
    } catch {
        return false;
    }
}

streamRouter.get('/api/proxy/stream', proxyLimiter, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (!isAllowedProxyUrl(url)) return res.status(403).json({ error: 'URL not allowed' });

    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            maxContentLength: 5 * 1024 * 1024,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
            },
            timeout: 10000
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

        const contentType = response.headers['content-type'];
        if (contentType) res.setHeader('Content-Type', contentType);

        response.data.pipe(res);
        response.data.on('error', () => {
            if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
        });
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ error: 'Proxy failed' });
    }
});

streamRouter.get('/api/stream', async (req, res) => {
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
                    imdbCache[tmdb] = imdbId;
                }
            }
        }

        if (imdbId) {
            console.log(`[Stream API] Found IMDb ID: ${imdbId}, returning multiple sources!`);
            const sources = [
                { name: "Основной", url: `https://api.ortified.ws/embed/imdb/${imdbId}` },
                { name: "Резерв", url: type === 'tv' || type === 'series' ? `https://vidsrc.me/embed/tv?imdb=${imdbId}` : `https://vidsrc.me/embed/movie?imdb=${imdbId}` }
            ];
            return res.json({
                iframe: sources[0].url,
                sources: sources
            });
        } else {
            console.log(`[Stream API] No IMDb ID found. Falling back to TMDB: ${tmdb}`);
            if (tmdb) {
                const isTv = type === 'tv' || type === 'series';
                const sources = [
                    { name: "Резерв", url: isTv ? `https://vidsrc.me/embed/tv?tmdb=${tmdb}` : `https://vidsrc.me/embed/movie?tmdb=${tmdb}` }
                ];
                return res.json({
                    iframe: sources[0].url,
                    sources: sources
                });
            }
            return res.status(404).json({ error: 'Not found' });
        }
    } catch (e) {
        console.log(`[Stream API] Failed to resolve stream: ${e.message}`);
        return res.status(500).json({ error: e.message });
    }
});
