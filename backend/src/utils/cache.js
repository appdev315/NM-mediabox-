import NodeCache from 'node-cache';
const memoryCache = new NodeCache({ stdTTL: 7200, checkperiod: 600 });
console.log('[Cache] In-memory NodeCache initialized');

const pendingMoviePromises = new Map();

export async function withMovieCache(key, ttlSeconds, fetcher) {
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
