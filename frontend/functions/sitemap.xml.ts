/**
 * Cloudflare Pages Function for Dynamic Sitemap Generation
 * Accessible at /sitemap.xml
 * Sources IDs from /api/feed/home (trending + popular genres) and caches output for 24h
 */

interface PagesContext {
  request: Request;
  waitUntil: (promise: Promise<any>) => void;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request } = context;

  // 1. Edge Cache lookup (1 day TTL)
  const edgeCache = (caches as any).default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  try {
    const cachedResponse = await edgeCache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  } catch (_) {}

  // 2. Fetch live movie and TV feeds from backend in parallel
  const [movieRes, tvRes] = await Promise.all([
    fetch('https://api.media-box.xyz/api/feed/home?type=movie', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    }).catch(() => null),
    fetch('https://api.media-box.xyz/api/feed/home?type=tv', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    }).catch(() => null),
  ]);

  const items: { id: number; type: 'movie' | 'series' }[] = [];
  const seenKeys = new Set<string>();

  const extractItems = (data: any, type: 'movie' | 'series') => {
    if (!data) return;
    const candidates: any[] = [];
    if (Array.isArray(data.trending)) {
      candidates.push(...data.trending);
    }
    if (Array.isArray(data.genres)) {
      for (const cat of data.genres) {
        if (Array.isArray(cat.rawResults)) {
          candidates.push(...cat.rawResults);
        }
      }
    }

    for (const item of candidates) {
      if (!item || !item.id) continue;
      const strId = String(item.id);
      // Skip non-numeric or Liftw temporary IDs
      if (strId.startsWith('liftw_') || !/^\d+$/.test(strId)) continue;
      const numId = parseInt(strId, 10);
      const key = `${type}_${numId}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        items.push({ id: numId, type });
      }
    }
  };

  if (movieRes && movieRes.ok) {
    try {
      const movieJson = await movieRes.json();
      extractItems(movieJson, 'movie');
    } catch (_) {}
  }

  if (tvRes && tvRes.ok) {
    try {
      const tvJson = await tvRes.json();
      extractItems(tvJson, 'series');
    } catch (_) {}
  }

  // 3. Assemble valid XML Sitemap
  const today = new Date().toISOString().split('T')[0];
  const baseUrl = 'https://media-box.xyz';

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // Root URL
  xml += '  <url>\n';
  xml += `    <loc>${baseUrl}/</loc>\n`;
  xml += `    <lastmod>${today}</lastmod>\n`;
  xml += '    <changefreq>daily</changefreq>\n';
  xml += '    <priority>1.0</priority>\n';
  xml += '  </url>\n';

  // Content URLs
  for (const item of items) {
    xml += '  <url>\n';
    xml += `    <loc>${baseUrl}/movie/${item.id}?type=${item.type}</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += '    <changefreq>weekly</changefreq>\n';
    xml += '    <priority>0.8</priority>\n';
    xml += '  </url>\n';
  }

  xml += '</urlset>';

  // 4. Return XML Response with 24h Edge Cache
  const response = new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });

  try {
    context.waitUntil(edgeCache.put(cacheKey, response.clone()));
  } catch (_) {}

  return response;
}
