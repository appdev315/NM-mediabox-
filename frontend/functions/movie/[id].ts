/**
 * Cloudflare Pages Function for Edge SEO Meta-injection
 * Intercepts requests to /movie/:id
 * Only executes for search engine & social media crawlers (0 overhead for regular users)
 */

interface PagesContext {
  request: Request;
  params: Record<string, string | string[]>;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<any>) => void;
}

const BOT_UA_REGEX = /telegrambot|whatsapp|facebookexternalhit|facebookcatalog|twitterbot|vkshare|discordbot|slackbot|linkedinbot|applebot|googlebot|bingbot|yandexbot|yandeximages|duckduckbot|baiduspider/i;

const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, params } = context;
  const userAgent = request.headers.get('user-agent') || '';

  // 1. Fast path for regular human browsers (zero latency overhead)
  if (!BOT_UA_REGEX.test(userAgent)) {
    return context.next();
  }

  const id = Array.isArray(params.id) ? params.id[0] : (params.id || '');
  if (!id) {
    return context.next();
  }

  // 2. Edge Cache lookup (shared across bot visits)
  const edgeCache = (caches as any).default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  try {
    const cachedResponse = await edgeCache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  } catch (_) {}

  // 3. Resolve target media type
  const urlObj = new URL(request.url);
  const typeParam = (urlObj.searchParams.get('type') || '').toLowerCase();
  let mediaType = (typeParam === 'tv' || typeParam === 'series') ? 'tv' : 'movie';

  // 4. Handle non-numeric / Liftw IDs (generate generic metadata without TMDB hit)
  const isNumericId = /^\d+$/.test(id);
  let tmdbData: any = null;

  if (isNumericId) {
    const buildTmdbUrl = (type: string) =>
      `https://api.media-box.xyz/api/tmdb/${type}/${id}?language=ru-RU&append_to_response=credits,translations`;

    try {
      let tmdbRes = await fetch(buildTmdbUrl(mediaType), {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(3500),
      });

      if (tmdbRes.status === 404) {
        // Fallback: try opposite media type (mirrors useApi.ts:836-847)
        const altType = mediaType === 'movie' ? 'tv' : 'movie';
        const altRes = await fetch(buildTmdbUrl(altType), {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(3500),
        });
        if (altRes.ok) {
          tmdbData = await altRes.json();
          mediaType = altType;
        }
      } else if (tmdbRes.ok) {
        tmdbData = await tmdbRes.json();
      }
    } catch (_) {}
  }

  // 5. Build localized metadata
  const isTv = mediaType === 'tv';
  const displayTitle = tmdbData?.title || tmdbData?.name || 'Фильм';
  const dateStr = tmdbData?.release_date || tmdbData?.first_air_date || '';
  const year = dateStr ? dateStr.slice(0, 4) : '';

  const pageTitle = isTv
    ? `Сериал ${displayTitle}${year ? ` (${year})` : ''} онлайн — MediaBox`
    : `Смотреть ${displayTitle}${year ? ` (${year})` : ''} онлайн — MediaBox`;

  const rawOverview = tmdbData?.overview || '';
  const metaDescription = rawOverview.length > 0
    ? (rawOverview.length > 160 ? rawOverview.slice(0, 157).trim() + '...' : rawOverview)
    : `Смотреть ${isTv ? 'сериал' : 'фильм'} «${displayTitle}»${year ? ` (${year})` : ''} онлайн в хорошем качестве на MediaBox.`;

  const backdrop = tmdbData?.backdrop_path || tmdbData?.poster_path;
  const ogImageUrl = backdrop
    ? `https://image.tmdb.org/t/p/w780${backdrop.startsWith('/') ? backdrop : '/' + backdrop}`
    : 'https://media-box.xyz/kiss-bg.png';

  const canonicalUrl = `https://media-box.xyz/movie/${id}?type=${isTv ? 'series' : 'movie'}`;
  const ogType = isTv ? 'video.tv_show' : 'video.movie';

  const jsonLd: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': isTv ? 'TVSeries' : 'Movie',
    name: displayTitle,
    description: metaDescription,
    image: ogImageUrl,
    url: canonicalUrl,
  };

  if (dateStr) {
    jsonLd.datePublished = dateStr;
  }
  if (Array.isArray(tmdbData?.genres) && tmdbData.genres.length > 0) {
    jsonLd.genre = tmdbData.genres.map((g: any) => g.name || g).filter(Boolean);
  }
  if (tmdbData?.vote_count > 0 && tmdbData?.vote_average) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(tmdbData.vote_average).toFixed(1),
      bestRating: '10',
      worstRating: '1',
      ratingCount: tmdbData.vote_count,
    };
  }

  // 6. Fetch downstream index.html
  const downstreamResponse = await context.next();

  // 7. Inject metadata and textual skeleton via HTMLRewriter
  const headInject = `
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(metaDescription)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta property="og:description" content="${escapeHtml(metaDescription)}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:site_name" content="MediaBox" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(metaDescription)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  `;

  const rootSkeleton = `
    <div style="font-family:sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#f5f5f5;background:#0b0f19;">
      <h1 style="font-size:28px;font-weight:800;margin-bottom:12px;">${escapeHtml(pageTitle)}</h1>
      <p style="font-size:15px;line-height:1.6;opacity:0.85;margin-bottom:20px;">${escapeHtml(metaDescription)}</p>
      <img src="${escapeHtml(ogImageUrl)}" alt="${escapeHtml(displayTitle)}" style="width:100%;max-width:600px;height:auto;border-radius:12px;" />
    </div>
  `;

  // HTMLRewriter is a built-in Cloudflare Worker/Pages global
  const rewriter = new (globalThis as any).HTMLRewriter()
    .on('head', {
      element(el: any) {
        el.append(headInject, { html: true });
      },
    })
    .on('#root', {
      element(el: any) {
        el.append(rootSkeleton, { html: true });
      },
    });

  const transformedResponse = rewriter.transform(downstreamResponse);

  // 8. Cache response on Edge (immutable movies for 30d, series for 6h)
  const cacheTtlHeader = isTv
    ? 'public, max-age=3600, s-maxage=21600'
    : 'public, max-age=3600, s-maxage=2592000';

  const finalHeaders = new Headers(transformedResponse.headers);
  finalHeaders.set('Cache-Control', cacheTtlHeader);

  const responseToReturn = new Response(transformedResponse.body, {
    status: transformedResponse.status,
    statusText: transformedResponse.statusText,
    headers: finalHeaders,
  });

  try {
    context.waitUntil(edgeCache.put(cacheKey, responseToReturn.clone()));
  } catch (_) {}

  return responseToReturn;
}
