/**
 * Cloudflare Pages Function for MediaBox TV (HLS Proxy)
 * Accessible at /api/proxy
 * Solves Mixed Content blocking (HTTP -> HTTPS) and CORS issues.
 */

export async function onRequest(context) {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Range",
        "Access-Control-Max-Age": "86400",
      }
    });
  }

  const urlObj = new URL(request.url);
  const targetUrl = urlObj.searchParams.get('url');

  if (!targetUrl) {
    return new Response("Missing 'url' parameter", { status: 400 });
  }

  // Security: Only allow HTTP/HTTPS, block private IPs
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return new Response("Invalid protocol", { status: 403 });
    }
    const host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.')) {
      return new Response("Invalid host", { status: 403 });
    }
  } catch (e) {
    return new Response("Invalid URL", { status: 400 });
  }

  const proxyBaseUrl = `${urlObj.origin}${urlObj.pathname}`;

  try {
    // Fetch the target URL
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*"
      }
    });

    // Prepare response headers with CORS
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    newHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range");

    // Check if it's an HLS manifest that needs rewriting
    const contentType = response.headers.get("Content-Type") || "";
    const isM3u8 = contentType.includes("mpegurl") || contentType.includes("m3u") || targetUrl.split('?')[0].toLowerCase().endsWith('.m3u8');

    if (isM3u8) {
      const bodyText = await response.text();
      const rewritten = rewriteM3u8(bodyText, targetUrl, proxyBaseUrl);
      
      newHeaders.delete("Content-Length"); // Length changed
      return new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }

    // If it's a video segment or anything else, stream it directly
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });

  } catch (error) {
    return new Response(`Proxy Error: ${error.message}`, { 
      status: 502,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }
}

/**
 * Rewrites URLs inside an M3U8 manifest to point back to this proxy.
 */
function rewriteM3u8(body, originalUrl, proxyBase) {
  const baseUrl = new URL(originalUrl);
  const baseDir = baseUrl.origin + baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);

  return body.split('\n').map(line => {
    const trimmed = line.trim();

    if (!trimmed) return line;

    // Rewrite URI="..." inside tags like #EXT-X-MAP
    if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
      return line.replace(/URI="([^"]+)"/g, (match, uri) => {
        let fullUrl = uri;
        if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
          fullUrl = new URL(uri, baseDir).href;
        }
        return `URI="${proxyBase}?url=${encodeURIComponent(fullUrl)}"`;
      });
    }

    if (trimmed.startsWith('#')) return line;

    // Segment or sub-playlist URL
    let fullUrl = trimmed;
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      fullUrl = new URL(trimmed, baseDir).href;
    }
    return `${proxyBase}?url=${encodeURIComponent(fullUrl)}`;
  }).join('\n');
}
