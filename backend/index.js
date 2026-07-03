import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as cheerio from 'cheerio';
import xvideosScraper from './xvideos.js';
import epornerScraper from './epornerScraper.js';
import { getAnwapDownloadInfo, getAnwapSeriesLink } from './anwapScraper.js';
import { getLatestDownloads as kinovasekLatest, searchDownloads as kinovasekSearch, getDownloadLinks as kinovasekLinks } from './downloadScraper.js';
import { getLatestDownloads as kinozumaLatest, searchDownloads as kinozumaSearch, getDownloadLinks as kinozumaLinks } from './kinozumaScraper.js';
import { translateItems, initTmdbCache } from './tmdbCache.js';

// Setup Global Proxy Rotation if defined
if (process.env.PROXY_URL) {
    const proxyUrls = process.env.PROXY_URL.split(',').map(u => u.trim()).filter(u => u);
    const proxyAgents = proxyUrls.map(url => new HttpsProxyAgent(url));
    console.log(`[Proxy] Configured ${proxyAgents.length} proxy agents for rotation.`);
    
    axios.defaults.proxy = false; // Disable axios's native proxy logic
    
    let proxyIndex = 0;
    axios.interceptors.request.use((config) => {
        if (proxyAgents.length > 0) {
            const agent = proxyAgents[proxyIndex];
            proxyIndex = (proxyIndex + 1) % proxyAgents.length;
            config.httpsAgent = agent;
            config.httpAgent = agent;
        }
        return config;
    });
}

import NodeCache from 'node-cache';
const memoryCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 });
console.log('[Cache] In-memory NodeCache initialized');
initTmdbCache(memoryCache);

const pendingMoviePromises = new Map();

async function withMovieCache(key, ttlSeconds, fetcher) {
    const cached = memoryCache.get(key);
    if (cached) return cached;
    
    if (pendingMoviePromises.has(key)) {
        return pendingMoviePromises.get(key);
    }
    
    const promise = fetcher().then(data => {
        memoryCache.set(key, data, ttlSeconds);
        pendingMoviePromises.delete(key);
        return data;
    }).catch(err => {
        pendingMoviePromises.delete(key);
        throw err;
    });
    
    pendingMoviePromises.set(key, promise);
    return promise;
}


const app = express();
const port = process.env.PORT || 7860;

// Server Metrics
const serverMetrics = {
    startTime: Date.now(),
    totalRequests: 0,
    successfulRequests: 0,
    errors: {
        total: 0,
        rateLimits: 0,
        notFounds: 0,
        internal: 0,
        donorBans: 0
    }
};

app.use((req, res, next) => {
    serverMetrics.totalRequests++;
    
    // Track response finish
    res.on('finish', () => {
        if (res.statusCode === 200 || res.statusCode === 304 || res.statusCode === 206) {
            serverMetrics.successfulRequests++;
        } else if (res.statusCode === 429) {
            serverMetrics.errors.rateLimits++;
            serverMetrics.errors.total++;
        } else if (res.statusCode === 404) {
            serverMetrics.errors.notFounds++;
            serverMetrics.errors.total++;
        } else if (res.statusCode >= 500) {
            serverMetrics.errors.internal++;
            serverMetrics.errors.total++;
        } else if (res.statusCode === 403) {
            serverMetrics.errors.donorBans++;
            serverMetrics.errors.total++;
        } else {
            serverMetrics.errors.total++;
        }
    });
    
    next();
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.BOT_TOKEN_MAIN || process.env.BOT_TOKEN;
    if (authHeader !== `Bearer ${expectedToken}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const uptimeSec = Math.floor((Date.now() - serverMetrics.startTime) / 1000);
    const stats = {
        uptime_seconds: uptimeSec,
        metrics: serverMetrics
    };
    
    // Reset stats after fetching (since we fetch daily)
    if (req.query.reset === 'true') {
        serverMetrics.totalRequests = 0;
        serverMetrics.successfulRequests = 0;
        serverMetrics.errors = {
            total: 0,
            rateLimits: 0,
            notFounds: 0,
            internal: 0,
            donorBans: 0
        };
        // Убрали сброс startTime, чтобы аптайм отражал реальное время работы контейнера
    }
    
    res.json(stats);
});

// Security Headers
app.use(helmet({
    crossOriginResourcePolicy: false, // allow remote fetching
}));

// Rate limiting (100 requests per 10 minutes per IP)
const limiter = rateLimit({
    windowMs: 10 * 60 * 1000, 
    max: 100, 
    standardHeaders: true, 
    legacyHeaders: false, 
    message: { error: "Too many requests from this IP, please try again after 10 minutes" }
});

// Apply rate limiting to all requests
app.use(limiter);

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Origin', 'Accept']
}));

// --- HEALTH ENDPOINT (For Cron-Job Ping to prevent Sleep) ---
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

import crypto from 'crypto';

// Middleware for Telegram Authentication


// Helper to verify Telegram WebAppData against dual tokens
function verifyTelegramWebAppData(initData) {
    const BOT_TOKEN_MAIN = process.env.BOT_TOKEN_MAIN || process.env.BOT_TOKEN;
    const BOT_TOKEN_ADULT = process.env.BOT_TOKEN_ADULT;
    
    if (!BOT_TOKEN_MAIN && !BOT_TOKEN_ADULT) {
        throw new Error('Missing BOT_TOKENs');
    }

    const q = new URLSearchParams(initData);
    const hash = q.get('hash');
    q.delete('hash');
    
    const keys = Array.from(q.keys());
    keys.sort();
    const dataCheckString = keys.map(k => `${k}=${q.get(k)}`).join('\n');
    
    const validateToken = (token) => {
        if (!token) return false;
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
        const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        return hmac === hash;
    };

    let matchedToken = null;
    let isAdultBot = false;
    
    if (validateToken(BOT_TOKEN_MAIN)) {
        matchedToken = BOT_TOKEN_MAIN;
    } else if (validateToken(BOT_TOKEN_ADULT)) {
        matchedToken = BOT_TOKEN_ADULT;
        isAdultBot = true;
    }
    
    if (!matchedToken) {
        return null; // Invalid signature
    }

    const userJson = q.get('user');
    if (!userJson) return null;
    
    return {
        user: JSON.parse(userJson),
        botToken: matchedToken,
        isAdultBot
    };
}

async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('tma ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const initData = authHeader.substring(4);
    if (!initData) {
        return res.status(401).json({ error: 'Unauthorized: Empty token data' });
    }

    try {
        const authData = verifyTelegramWebAppData(initData);
        if (!authData) {
            return res.status(401).json({ error: 'Unauthorized: Invalid signature' });
        }
        
        req.user = authData.user;
        req.botToken = authData.botToken;
        req.isAdultBot = authData.isAdultBot;
        next();
    } catch (e) {
        if (e.message === 'Missing BOT_TOKENs') {
            return res.status(500).json({ error: 'Server configuration error' });
        }
        return res.status(401).json({ error: 'Unauthorized: Token parsing failed' });
    }
}



async function checkAdultAccess(req, res, next) {
    // App is now completely free, no VIP check required
    return next();
}


// Function to validate URL for SSRF protection
function isValidUrl(urlStr) {
    try {
        const parsed = new URL(urlStr);
        const hostname = parsed.hostname;
        const allowedDomains = ['kinozuma.net', 'kinovasek.net', 'anwap.tube', 'anwap.im', 'anwap.bio', 'anwap.site', 'anwap.pm', 'anwap.best', 'mj.anwap.today', 'mm.anwap.media', 'm.anwap.media'];
        
        // Exact match
        if (allowedDomains.includes(hostname)) return true;
        
        // Strict subdomain match (must end with .domain)
        const allowedSuffixes = ['.anwap.tube', '.kinozuma.net', '.kinovasek.net'];
        for (const suffix of allowedSuffixes) {
            if (hostname.endsWith(suffix)) return true;
        }
        
        return false;
    } catch (e) {
        return false;
    }
}

// --- DOWNLOADS API ---
app.get('/api/downloads/latest', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const targetLanguage = req.query.lang || 'en-US';
        const cacheKey = `movies_latest_${page}_${targetLanguage}`;

        const finalData = await withMovieCache(cacheKey, 7200, async () => {
            let results = [];
            if (page === 1) {
                const [kinozuma, kinovasek] = await Promise.all([
                    kinozumaLatest(),
                    kinovasekLatest(page)
                ]);
                results = [...kinozuma, ...kinovasek];
            } else {
                results = await kinovasekLatest(page);
            }

            // Deduplicate
            const seen = new Set();
            results = results.filter(item => {
                if (!item.title) return false;
                if (seen.has(item.title)) return false;
                seen.add(item.title);
                return true;
            });

            return await translateItems(results, targetLanguage);
        });

        res.json(finalData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/downloads/search', async (req, res) => {
    try {
        const q = req.query.q;
        const targetLanguage = req.query.lang || 'en-US';
        if (!q) return res.status(400).json({ error: 'Query required' });
        const cacheKey = `movies_search_${q}_${targetLanguage}`;

        const finalData = await withMovieCache(cacheKey, 7200, async () => {
            const [kinozuma, kinovasek] = await Promise.all([
                kinozumaSearch(q),
                kinovasekSearch(q)
            ]);
            
            let results = [...kinozuma, ...kinovasek];
            
            // Deduplicate
            const seen = new Set();
            results = results.filter(item => {
                if (!item.title) return false;
                if (seen.has(item.title)) return false;
                seen.add(item.title);
                return true;
            });

            return await translateItems(results, targetLanguage);
        });

        res.json(finalData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/downloads/links', async (req, res) => {
    try {
        const urlStr = req.query.url;
        if (!urlStr) return res.status(400).json({ error: 'URL required' });
        const decodedUrl = Buffer.from(urlStr, 'base64').toString('utf8');
        
        if (!isValidUrl(decodedUrl)) {
            return res.status(403).json({ error: 'Forbidden: Invalid domain (SSRF Protection)' });
        }
        
        let responseLinks = [];
        if (decodedUrl.includes('kinozuma.net')) {
            responseLinks = await kinozumaLinks(decodedUrl);
        } else {
            const data = await kinovasekLinks(decodedUrl);
            responseLinks = data.links || [];
        }

        res.json({ links: responseLinks });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Video proxy for sites with hotlink protection (Kinozuma/Kinovasek)
app.get('/api/downloads/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    try {
        let referer = 'https://mobile.kinozuma.net';
        if (targetUrl.includes('vasqa.org') || targetUrl.includes('serversimka.net') || targetUrl.includes('kinovasek.net')) {
            referer = 'https://kinovasek.net';
        }

        const response = await axios({
            url: targetUrl,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'Referer': referer,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

        response.data.pipe(res);
    } catch (error) {
        console.error('Proxy Error:', error.message);
        res.status(500).send('Failed to proxy video');
    }
});

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



// --- Download (Anwap Scraper) ---

app.get('/api/download/info', async (req, res) => {
    const { title, isTv } = req.query;
    if (!title) return res.status(400).json({ error: 'Title required' });
    
    try {
        const info = await getAnwapDownloadInfo(title, isTv === 'true');
        return res.json(info);
    } catch (e) {
        console.error('[VIP Download Info]', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.get('/api/download/link', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    try {
        if (!isValidUrl(url)) {
            return res.status(403).json({ error: 'Forbidden: Invalid domain (SSRF Protection)' });
        }
        const info = await getAnwapSeriesLink(url);
        return res.json(info);
    } catch (e) {
        console.error('[VIP Download Link]', e.message);
        return res.status(500).json({ error: e.message });
    }
});



// --- Adult (18+) Endpoints ---

// --- Adult (18+) Endpoints ---
app.get('/api/adult/search', checkAdultAccess, async (req, res) => {
    const { q, page } = req.query;
    try {
        const p = page ? parseInt(page) : 0;
        const [xvideosResults, epornerResults] = await Promise.all([
            xvideosScraper.search(q, p),
            epornerScraper.search(q, p)
        ]);
        
        // Interleave the arrays to mix them nicely
        const mixed = [];
        const maxLen = Math.max(xvideosResults.length, epornerResults.length);
        for(let i=0; i<maxLen; i++) {
            if (epornerResults[i]) mixed.push(epornerResults[i]);
            if (xvideosResults[i]) mixed.push(xvideosResults[i]);
        }
        
        return res.json(mixed);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.get('/api/adult/stream', checkAdultAccess, async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    
    try {
        let details;
        if (id.startsWith('eporner_')) {
            details = await epornerScraper.getVideoDetails(id);
        } else {
            details = await xvideosScraper.getVideoDetails(id);
        }
        
        if (details) {
            return res.json(details);
        } else {
            return res.status(404).json({ error: 'Video not found' });
        }
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// Video proxy endpoint removed — users now get direct download links
// This saves bandwidth and CPU on the server

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port} with Anwap Smart Mirror selector`);
});
// trigger deploy
