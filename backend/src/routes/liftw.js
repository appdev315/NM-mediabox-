import express from 'express';
import axios from 'axios';

export const liftwRouter = express.Router();

const LIFTW_API = 'https://api.liftw.ws';

// Search liftw.ws and return iframe URL for the best match
liftwRouter.get('/api/liftw', async (req, res) => {
    const { title, year, type, tmdb } = req.query;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    try {
        const isSeriesRequest = type === 'tv' || type === 'series';
        
        // Collect candidate titles to search and match
        const candidates = new Set();
        candidates.add(title.trim());

        if (tmdb) {
            try {
                const tmdbType = isSeriesRequest ? 'tv' : 'movie';
                const TMDB_API_KEY = process.env.TMDB_API_KEY || 'cd5b69242e715dc87d65957d7460eba2';
                const tmdbRes = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdb}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles,translations`, {
                    timeout: 4000
                });
                
                const tmdbData = tmdbRes.data;
                if (tmdbData) {
                    if (tmdbData.title) candidates.add(tmdbData.title.trim());
                    if (tmdbData.name) candidates.add(tmdbData.name.trim());
                    if (tmdbData.original_title) candidates.add(tmdbData.original_title.trim());
                    if (tmdbData.original_name) candidates.add(tmdbData.original_name.trim());

                    // alternative titles
                    const altResults = tmdbType === 'tv' 
                        ? (tmdbData.alternative_titles?.results || []) 
                        : (tmdbData.alternative_titles?.titles || []);
                    for (const r of altResults) {
                        if (r.title) candidates.add(r.title.trim());
                    }

                    // translations
                    const transResults = tmdbData.translations?.translations || [];
                    for (const t of transResults) {
                        const nameVal = t.data?.name || t.data?.title;
                        if (nameVal) candidates.add(nameVal.trim());
                    }
                }
            } catch (err) {
                console.error('[liftw] Failed to fetch TMDB translations:', err.message);
            }
        }

        const cleanCandidates = Array.from(candidates).filter(Boolean);
        const hasCyrillic = (str) => /[а-яё]/i.test(str);
        const hasLatin = (str) => /[a-z]/i.test(str);

        const prioritizedCandidates = cleanCandidates.sort((a, b) => {
            const aCyr = hasCyrillic(a);
            const bCyr = hasCyrillic(b);
            if (aCyr && !bCyr) return -1;
            if (!aCyr && bCyr) return 1;

            const aLat = hasLatin(a);
            const bLat = hasLatin(b);
            if (aLat && !bLat) return -1;
            if (!aLat && bLat) return 1;

            return 0;
        });

        // type mapping: liftw types: 1=movie, 2=cartoon, 6=anime movie | 3=series, 5=animated series, 7=anime series, 4=tv show
        const validTypes = isSeriesRequest ? [3, 4, 5, 7] : [1, 2, 6];
        const yearStr = year ? String(year) : '';

        const norm = (str) => String(str).toLowerCase().replace(/[^a-zа-я0-9]/gi, '').trim();

        const matchCandidate = (item) => {
            const typeMatch = validTypes.includes(item.type);
            const itemYear = parseInt(item.year);
            const targetYear = parseInt(yearStr);
            const yearMatch = yearStr ? (itemYear === targetYear || itemYear === targetYear + 1 || itemYear === targetYear - 1) : true;
            
            if (!typeMatch || !yearMatch) return false;

            const nameLower = norm(item.name);
            const origLower = norm(item.origin_name);

            return prioritizedCandidates.some(cand => {
                const candNorm = norm(cand);
                return nameLower === candNorm || origLower === candNorm;
            });
        };

        // Try searching Liftw with prioritized candidates sequentially (limit to top 3)
        let bestMatch = null;
        const searchCandidates = prioritizedCandidates.slice(0, 3);

        for (const cand of searchCandidates) {
            try {
                const searchRes = await axios.get(`${LIFTW_API}/search`, {
                    params: { q: cand },
                    timeout: 4000
                });
                const items = searchRes.data?.items || [];
                bestMatch = items.find(matchCandidate);
                if (bestMatch) {
                    break;
                }
            } catch (err) {
                console.error(`[liftw] Search failed for "${cand}":`, err.message);
            }
        }

        // Fallback: if no match found, return 404 to avoid playing incorrect video
        if (!bestMatch) {
            return res.status(404).json({ error: 'Exact match not found on liftw' });
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
            liftwType: info.type,
            name: info.name,
            episodes: info.episodes || null
        });

    } catch (e) {
        console.error('[liftw] Error:', e.message);
        if (e.response && e.response.status === 404) {
            return res.status(404).json({ error: 'Not found on liftw' });
        }
        return res.status(500).json({ error: e.message });
    }
});
