import express from 'express';
import xvideosScraper from '../../xvideos.js';
import epornerScraper from '../../epornerScraper.js';
import { checkAdultAccess } from '../middlewares/auth.js';

export const adultRouter = express.Router();

adultRouter.get('/api/adult/search', checkAdultAccess, async (req, res) => {
    const { q, page } = req.query;
    try {
        const p = page ? parseInt(page) : 0;
        const [xvideosResults, epornerResults] = await Promise.all([
            xvideosScraper.search(q, p),
            epornerScraper.search(q, p)
        ]);

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

adultRouter.get('/api/adult/stream', checkAdultAccess, async (req, res) => {
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
