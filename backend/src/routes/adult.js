import express from 'express';
import axios from 'axios';
import { checkAdultAccess } from '../middlewares/auth.js';

export const adultRouter = express.Router();

const GO_SERVICE_URL = 'http://localhost:8080';

adultRouter.get('/api/adult/search', checkAdultAccess, async (req, res) => {
    const { q, page } = req.query;
    try {
        const response = await axios.get(`${GO_SERVICE_URL}/api/adult/search`, {
            params: { q, page },
            timeout: 10000
        });
        return res.json(response.data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

adultRouter.get('/api/adult/stream', checkAdultAccess, async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    try {
        const response = await axios.get(`${GO_SERVICE_URL}/api/adult/details`, {
            params: { id },
            timeout: 10000
        });
        return res.json(response.data);
    } catch (e) {
        if (e.response && e.response.status === 404) {
            return res.status(404).json({ error: 'Video not found' });
        }
        return res.status(500).json({ error: e.message });
    }
});
