import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import xvideosScraper from './xvideos.js';
import epornerScraper from './epornerScraper.js';
import { getAnwapDownloadInfo, getAnwapSeriesLink } from './anwapScraper.js';
import { getLatestDownloads as kinovasekLatest, searchDownloads as kinovasekSearch, getDownloadLinks as kinovasekLinks } from './downloadScraper.js';
import { getLatestDownloads as kinozumaLatest, searchDownloads as kinozumaSearch, getDownloadLinks as kinozumaLinks } from './kinozumaScraper.js';
import { translateItems, initTmdbCache } from './tmdbCache.js';
import { getCurrentPhase } from './monetization.js';
import { createClient } from 'redis';
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.error('[Redis] Error', err));
redisClient.connect().then(() => {
    console.log('[Redis] Connected');
    initTmdbCache(redisClient);
}).catch(e => console.error('[Redis] Connection failed', e));

const pendingMoviePromises = new Map();

async function withMovieCache(key, ttlSeconds, fetcher) {
    try {
        const cached = await redisClient.get(key);
        if (cached) return JSON.parse(cached);
    } catch(e) {
        console.error('[Redis] GET Error', e);
    }
    
    if (pendingMoviePromises.has(key)) {
        return pendingMoviePromises.get(key);
    }
    
    const promise = fetcher().then(data => {
        redisClient.setEx(key, ttlSeconds, JSON.stringify(data)).catch(e => console.error('[Redis] SET Error', e));
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
const VIP_USERS = ['appdev315'];

async function requireVip(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('tma ')) {
        req.user = null; // Guest user
        return next();
    }

    const initData = authHeader.substring(4);
    if (!initData) {
        req.user = null;
        return next();
    }

    const BOT_TOKEN = process.env.BOT_TOKEN;
    
    if (!BOT_TOKEN) {
        console.error('Server configuration error: missing BOT_TOKEN');
        req.user = null;
        return next();
    }

    try {
        const q = new URLSearchParams(initData);
        const hash = q.get('hash');
        q.delete('hash');
        
        const keys = Array.from(q.keys());
        keys.sort();
        const dataCheckString = keys.map(k => `${k}=${q.get(k)}`).join('\n');
        
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        
        if (hmac !== hash) {
            req.user = null;
            return next();
        }

        const userJson = q.get('user');
        if (!userJson) {
            req.user = null;
            return next();
        }
        
        const user = JSON.parse(userJson);
        req.user = user;
        next();
    } catch (e) {
        req.user = null;
        next();
    }
}

// Function to validate URL for SSRF protection
function isValidUrl(urlStr) {
    try {
        const parsed = new URL(urlStr);
        const hostname = parsed.hostname;
        const allowedDomains = ['kinozuma.net', 'kinovasek.net', 'anwap.tube', 'anwap.im', 'anwap.bio', 'anwap.site', 'anwap.pm', 'anwap.best', 'mj.anwap.today', 'mm.anwap.media', 'm.anwap.media'];
        return allowedDomains.includes(hostname) || 
               hostname.endsWith('.anwap.tube') || 
               hostname.endsWith('.kinozuma.net') || 
               hostname.endsWith('.kinovasek.net');
    } catch (e) {
        return false;
    }
}

// --- VIP STATUS API ---
app.get('/api/vip/status', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('tma ')) {
            return res.json({ isVip: false });
        }
        const initData = authHeader.substring(4);
        const BOT_TOKEN = process.env.BOT_TOKEN;
        if (!BOT_TOKEN) return res.json({ isVip: false });
        
        const q = new URLSearchParams(initData);
        const hash = q.get('hash');
        q.delete('hash');
        const keys = Array.from(q.keys());
        keys.sort();
        const dataCheckString = keys.map(k => `${k}=${q.get(k)}`).join('\n');
        
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        
        if (hmac !== hash) return res.json({ isVip: false });
        
        const userJson = q.get('user');
        if (!userJson) return res.json({ isVip: false });
        
        const user = JSON.parse(userJson);
        const userId = user.id;
        
        if (user.username && VIP_USERS.includes(user.username)) {
            return res.json({ isVip: true });
        }
        
        const isVip = await redisClient.get(`vip:${userId}`);
        return res.json({ isVip: !!isVip });
    } catch (e) {
        return res.json({ isVip: false });
    }
});

// --- VIP DOWNLOADS API ---
app.get('/api/vip/downloads/latest', requireVip, async (req, res) => {
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

app.get('/api/vip/downloads/search', requireVip, async (req, res) => {
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

app.get('/api/vip/downloads/links', requireVip, async (req, res) => {
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

app.get('/api/config', (req, res) => {
    return res.json(getCurrentPhase());
});

app.post('/api/invoice', express.json(), async (req, res) => {
    try {
        const { plan, userId } = req.body;
        const BOT_TOKEN = process.env.BOT_TOKEN;
        if (!BOT_TOKEN) {
            console.error('Missing BOT_TOKEN in environment variables!');
            return res.status(500).json({ error: 'Server configuration error' });
        }
        
        let amount = 0;
        let label = '';
        let title = '';
        let payload = '';

        const phaseConfig = getCurrentPhase();
        
        if (plan === '1_month') {
            amount = phaseConfig.priceMonth;
            label = `1 Month VIP`;
            title = 'VIP Subscription (1 Month)';
            payload = `vip_1month_${userId}_${Date.now()}`;
        } else if (plan === 'lifetime') {
            if (phaseConfig.priceLifetime === null) {
                return res.status(400).json({ error: 'Lifetime subscription not available in this phase' });
            }
            amount = phaseConfig.priceLifetime;
            label = 'Lifetime VIP';
            title = 'VIP Subscription (Lifetime)';
            payload = `vip_lifetime_${userId}_${Date.now()}`;
        } else {
            return res.status(400).json({ error: 'Invalid plan' });
        }

        const invoiceData = {
            title: title,
            description: 'Watch movies without ads, directly from our servers.',
            payload: payload,
            provider_token: '', // Required empty string for Telegram Stars
            currency: 'XTR',
            prices: [{ label: label, amount: amount }]
        };

        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, invoiceData);
        
        if (response.data.ok) {
            return res.json({ invoiceUrl: response.data.result });
        } else {
            console.error('[Invoice API] Error from Telegram:', response.data.description);
            return res.status(500).json({ error: response.data.description });
        }
    } catch (e) {
        console.error('[Invoice API] Request failed:', e.message);
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/telegram/webhook', express.json(), async (req, res) => {
    try {
        const update = req.body;
        
        // Handle Pre Checkout Query
        if (update.pre_checkout_query) {
            const preCheckoutQueryId = update.pre_checkout_query.id;
            const BOT_TOKEN = process.env.BOT_TOKEN;
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
                pre_checkout_query_id: preCheckoutQueryId,
                ok: true
            });
            return res.json({ ok: true });
        }

        // Handle Successful Payment
        if (update.message && update.message.successful_payment) {
            const payment = update.message.successful_payment;
            const payload = payment.invoice_payload;
            const userId = update.message.from.id;
            
            // payload format: vip_1month_userId_timestamp
            if (payload.startsWith('vip_')) {
                // Grant VIP status in Redis
                const isMonthly = payload.includes('_1month_');
                if (isMonthly) {
                    await redisClient.setEx(`vip:${userId}`, 30 * 24 * 60 * 60, 'true');
                } else {
                    await redisClient.set(`vip:${userId}`, 'true');
                }
                console.log(`[Webhook] VIP granted for user ${userId}, monthly: ${isMonthly}`);
            }
            return res.json({ ok: true });
        }

        res.json({ ok: true });
    } catch (e) {
        console.error('[Webhook] Error handling update:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// --- VIP Download (Anwap Scraper) ---

app.get('/api/vip/download/info', requireVip, async (req, res) => {
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

app.get('/api/vip/download/link', requireVip, async (req, res) => {
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
app.get('/api/adult/search', requireVip, async (req, res) => {
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

app.get('/api/adult/stream', requireVip, async (req, res) => {
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

app.get('/api/vip/downloads/proxy', async (req, res) => {
    try {
        const urlStr = req.query.url;
        if (!urlStr) return res.status(400).send('URL required');
        const decodedUrl = Buffer.from(urlStr, 'base64').toString('utf8');
        
        let referer = 'https://kinozuma.net';
        if (decodedUrl.includes('vasqa.org') || decodedUrl.includes('serversimka.net') || decodedUrl.includes('kinovasek.net')) {
            referer = 'https://kinovasek.net';
        }

        const response = await axios({
            url: decodedUrl,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'Referer': referer,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });
        
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Content-Disposition', 'attachment; filename="movie.mp4"');
        res.setHeader('Access-Control-Allow-Origin', '*');

        response.data.pipe(res);
    } catch (e) {
        console.error('Proxy error:', e.message);
        res.status(500).send('Proxy error');
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port} with Anwap Smart Mirror selector`);
});
// trigger deploy
