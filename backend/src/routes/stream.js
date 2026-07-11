import express from 'express';
import axios from 'axios';
import { proxyLimiter } from '../middlewares/rateLimiter.js';

export const streamRouter = express.Router();

const GO_SERVICE_URL = 'http://localhost:8080';

streamRouter.get('/api/proxy/stream', proxyLimiter, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        const response = await axios({
            method: 'GET',
            url: `${GO_SERVICE_URL}/api/proxy/stream`,
            params: { url },
            responseType: 'stream',
            timeout: 30000
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

        const ct = response.headers['content-type'];
        if (ct) res.setHeader('Content-Type', ct);
        
        const cl = response.headers['content-length'];
        if (cl) res.setHeader('Content-Length', cl);

        const cr = response.headers['content-range'];
        if (cr) res.setHeader('Content-Range', cr);

        response.data.pipe(res);
        response.data.on('error', () => {
            if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
        });
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ error: 'Proxy failed' });
    }
});

streamRouter.get('/api/proxy', proxyLimiter, async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        const response = await axios({
            method: 'GET',
            url: `${GO_SERVICE_URL}/api/proxy`,
            params: { url },
            responseType: 'stream',
            timeout: 30000
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

        const ct = response.headers['content-type'];
        if (ct) res.setHeader('Content-Type', ct);
        
        const cl = response.headers['content-length'];
        if (cl) res.setHeader('Content-Length', cl);

        const cr = response.headers['content-range'];
        if (cr) res.setHeader('Content-Range', cr);

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

    try {
        const response = await axios.get(`${GO_SERVICE_URL}/api/stream`, {
            params: { title, year, type, tmdb, imdb },
            timeout: 10000
        });
        return res.json(response.data);
    } catch (e) {
        if (e.response && e.response.status === 404) {
            return res.status(404).json({ error: 'Not found' });
        }
        return res.status(500).json({ error: e.message });
    }
});
