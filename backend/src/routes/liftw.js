import express from 'express';
import axios from 'axios';

export const liftwRouter = express.Router();

const LIFTW_API = 'https://api.liftw.ws';

// Search liftw.ws and return iframe URL for the best match
liftwRouter.get('/api/liftw', async (req, res) => {
    const { title, year, type } = req.query;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    try {
        // Search by title
        const searchRes = await axios.get(`${LIFTW_API}/search`, {
            params: { q: title },
            timeout: 8000
        });

        const items = searchRes.data?.items || [];
        if (items.length === 0) {
            return res.status(404).json({ error: 'Not found on liftw' });
        }

        // type mapping: liftw type 1 = movie, type 3 = series
        const isSeriesRequest = type === 'tv' || type === 'series';
        const targetType = isSeriesRequest ? 3 : 1;

        // Find best match: prefer same type, then match by year
        let bestMatch = null;
        const titleLower = String(title).toLowerCase().trim();
        const yearStr = year ? String(year) : '';

        for (const item of items) {
            const nameMatch = item.name?.toLowerCase().trim() === titleLower || 
                              item.origin_name?.toLowerCase().trim() === titleLower;
            const yearMatch = yearStr ? String(item.year) === yearStr : true;
            const typeMatch = item.type === targetType;

            if (nameMatch && yearMatch && typeMatch) {
                bestMatch = item;
                break;
            }
            if (nameMatch && typeMatch && !bestMatch) {
                bestMatch = item;
            }
            if (nameMatch && yearMatch && !bestMatch) {
                bestMatch = item;
            }
        }

        // Fallback: just use the first result of matching type, or first overall
        if (!bestMatch) {
            bestMatch = items.find(i => i.type === targetType) || items[0];
        }

        // Get detailed info
        const infoRes = await axios.get(`${LIFTW_API}/info/${bestMatch.id}`, {
            timeout: 8000
        });

        const info = infoRes.data;
        if (!info || !info.iframe_uri) {
            return res.status(404).json({ error: 'No iframe found on liftw' });
        }

        return res.json({
            iframe: info.iframe_uri,
            liftwId: info.id,
            liftwType: info.type, // 1=movie, 3=series
            name: info.name,
            episodes: info.episodes || null // null for movies, {season: [episodes]} for series
        });

    } catch (e) {
        console.error('[liftw] Error:', e.message);
        if (e.response && e.response.status === 404) {
            return res.status(404).json({ error: 'Not found on liftw' });
        }
        return res.status(500).json({ error: e.message });
    }
});
