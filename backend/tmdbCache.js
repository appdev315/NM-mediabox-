
const TMDB_API_KEY = 'cd5b69242e715dc87d65957d7460eba2';
let cache = null;

export function initTmdbCache(cacheInstance) {
  cache = cacheInstance;
}

async function tmdbFetch(endpoint, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  url.searchParams.append('api_key', TMDB_API_KEY);
  url.searchParams.append('language', 'en-US');
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== '') {
      url.searchParams.append(key, String(val));
    }
  });

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`TMDB Error: ${response.status}`);
  return response.json();
}

export async function translateItem(item) {
  // item: { id, title, poster, info, source }
  const yearMatch = item.info?.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : null;
  const cacheKey = `tmdb_${item.title}_${year || 'any'}`;

  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...item, ...cached };
    }
  }

  try {
    let tmdbRes = await tmdbFetch('/search/multi', { query: item.title });

    // Fallback if not found
    if (!tmdbRes.results || tmdbRes.results.length === 0) {
      const firstWord = item.title.split(' ')[0];
      if (firstWord && firstWord.length > 2) {
        tmdbRes = await tmdbFetch('/search/multi', { query: firstWord });
      }
    }

    if (tmdbRes.results && tmdbRes.results.length > 0) {
      let match = tmdbRes.results[0];
      if (year) {
        const betterMatch = tmdbRes.results.find((r) => {
          const rYear = r.release_date ? r.release_date.split('-')[0] : (r.first_air_date ? r.first_air_date.split('-')[0] : '');
          return rYear === year;
        });
        if (betterMatch) match = betterMatch;
      }

      if (match.title || match.name) {
        let title = match.title || match.name;
        let poster = match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : item.poster;
        let info = item.info;

        try {
          // Fetch full details for English genres and country
          const type = match.media_type === 'tv' ? 'tv' : 'movie';
          const details = await tmdbFetch(`/${type}/${match.id}`);
          if (details) {
            title = details.title || details.name;
            const country = details.production_countries?.[0]?.name || '';
            const g = details.genres?.map(g => g.name).join(', ') || '';
            const englishInfo = [country, year, g].filter(Boolean).join(' / ');
            if (englishInfo) info = englishInfo;
          }
        } catch (e) {
          console.error('Details fetch failed for', match.id);
        }

        const translatedData = { title, poster, info };
        if (cache) {
          cache.set(cacheKey, translatedData, 86400 * 7); // Cache for 7 days
        }
        return { ...item, ...translatedData };
      }
    }
  } catch (e) {
    console.error('TMDB Mapping failed for', item.title, e.message);
  }

  // Cache original data so we don't retry failed TMDB searches repeatedly
  if (cache) {
    cache.set(cacheKey, {}, 86400); // Cache empty for 1 day
  }
  return item;
}

export async function translateItems(items, targetLanguage) {
  if (targetLanguage !== 'en-US') return items;
  // Translate concurrently to speed up the process
  return await Promise.all(items.map(item => translateItem(item)));
}
