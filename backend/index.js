import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Setup Global Proxy Rotation if defined
if (process.env.PROXY_URL) {
    const proxyUrls = process.env.PROXY_URL.split(',').map(u => u.trim()).filter(u => u);
    const proxyAgents = proxyUrls.map(url => new HttpsProxyAgent(url));
    console.log(`[Proxy] Configured ${proxyAgents.length} proxy agents for rotation.`);

    axios.defaults.proxy = false;

    let proxyIndex = 0;
    axios.interceptors.request.use((config) => {
        const isLocal = config.url && (
            config.url.includes('localhost') || 
            config.url.includes('127.0.0.1') || 
            config.url.startsWith('/')
        );
        if (proxyAgents.length > 0 && !isLocal) {
            const agent = proxyAgents[proxyIndex];
            proxyIndex = (proxyIndex + 1) % proxyAgents.length;
            config.httpsAgent = agent;
            config.httpAgent = agent;
        }
        return config;
    });
}

import { globalLimiter } from './src/middlewares/rateLimiter.js';
import { serverMetrics, statsRouter } from './src/routes/stats.js';
import { tmdbRouter } from './src/routes/tmdb.js';
import { streamRouter } from './src/routes/stream.js';
import { adultRouter } from './src/routes/adult.js';

const app = express();
const port = process.env.PORT || 7860;

app.use((req, res, next) => {
    serverMetrics.totalRequests++;
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

app.use(helmet({
    crossOriginResourcePolicy: false,
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    frameguard: {
        action: 'deny'
    }
}));

app.use(globalLimiter);

const envOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) : [];
const defaultOrigins = ['https://web.telegram.org', 'https://media-box.xyz', 'https://www.media-box.xyz', 'https://moviemaniak5555.xyz', 'http://localhost:5173', 'http://localhost:3000'];
const allowedOrigins = [...new Set([...envOrigins, ...defaultOrigins])];

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

app.get('/', (req, res) => res.json({ status: 'OK', message: 'MediaBox API is running' }));

// Mount routers
app.use(statsRouter);
app.use(tmdbRouter);
app.use(streamRouter);
app.use(adultRouter);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port} with Anwap Smart Mirror selector`);
});
