import express from 'express';
import axios from 'axios';

export const liftwRouter = express.Router();

const GO_SERVICE_URL = process.env.GO_SERVICE_URL || 'http://localhost:8080';

// Proxy /api/liftw to the Go microservice
liftwRouter.get('/api/liftw', async (req, res) => {
    const { title, year, type, tmdb, bypass_cache } = req.query;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    try {
        const response = await axios.get(`${GO_SERVICE_URL}/api/liftw`, {
            params: { title, year, type, tmdb, bypass_cache },
            timeout: 15000
        });
        return res.json(response.data);
    } catch (e) {
        if (e.response && e.response.status === 404) {
            let goErr = 'Not found on liftw (Go)';
            if (e.response.data) {
                if (typeof e.response.data === 'string') {
                    goErr = e.response.data;
                } else if (e.response.data.error) {
                    goErr = e.response.data.error;
                }
            }
            return res.status(404).json({ error: goErr });
        }
        return res.status(500).json({ error: e.message });
    }
});
