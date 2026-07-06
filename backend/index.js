import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

import xvideosScraper from './xvideos.js';
import epornerScraper from './epornerScraper.js';

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
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    frameguard: {
        action: 'deny'
    }
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

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['https://web.telegram.org', 'https://media-box.xyz', 'https://www.media-box.xyz', 'http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || (origin && (origin.includes('localhost') || origin.includes('127.0.0.1')))) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Origin', 'Accept']
}));

// --- HEALTH ENDPOINT (For Cron-Job Ping to prevent Sleep) ---
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- TMDB API PROXY ---
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'cd5b69242e715dc87d65957d7460eba2';

app.get('/api/tmdb/*', async (req, res) => {
    const endpoint = req.params[0];
    const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
    
    // Forward all query parameters
    for (const [key, value] of Object.entries(req.query)) {
        url.searchParams.append(key, value);
    }
    url.searchParams.set('api_key', TMDB_API_KEY);

    const cacheKey = `tmdb_${url.toString()}`;
    const ttl = url.pathname.includes('/search') ? 7200 : 86400; // 2h search, 24h details
    
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
                    // wait 1 sec before retry
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




app.get('/', (req, res) => res.json({ status: 'OK', message: 'MediaBox API is running' }));

// --- Lightweight CORS proxy for HTTPS m3u8 manifests only ---
// Does NOT proxy video segments or HTTP streams (too much bandwidth).
// HTTP streams are filtered out on frontend instead.

const proxyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many proxy requests, slow down' }
});

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

app.get('/api/proxy/stream', proxyLimiter, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    if (!isAllowedProxyUrl(url)) return res.status(403).json({ error: 'URL not allowed' });

    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            maxContentLength: 5 * 1024 * 1024, // 5MB — enough for manifests
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
        for (let i = 0; i < maxLen; i++) {
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



// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port} with Anwap Smart Mirror selector`);
});
// trigger deploy
