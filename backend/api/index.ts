import { createClient } from '@supabase/supabase-js';
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";
import { translate } from "google-translate-api-x";
import https from "https";
import { chromium, Browser } from 'playwright-chromium';

// Singleton browser instance for Playwright
let _browser: Browser | null = null;
let _browserBusy = false;

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  console.log('[Playwright] Launching browser...');
  _browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  console.log('[Playwright] Browser launched.');
  return _browser;
}

async function fetchPagesWithBrowser(urls: string[], stealth: boolean = false): Promise<string[]> {
  // If not in stealth mode, try parallel axios first (standard behavior)
  // Always try parallel axios first (standard behavior is much faster and more reliable)
  try {
    console.log(`[Sequential] Fetching ${urls.length} pages via Axios...`);
    const results = [];
    for (const url of urls) {
      results.push(await fetchHtml(url).catch(() => ""));
      await new Promise(r => setTimeout(r, 250)); // Delay to prevent rate limit
    }
    if (results.some(html => html.includes('my_razdel film') || html.includes('filmscreen') || html.includes('serialscreen'))) {
      return results;
    }
  } catch (e) {}

  let attempts = 0;
  const maxAttempts = 30; // Wait up to 30 seconds

  while (_browserBusy && attempts < maxAttempts) {
    console.log(`[Queue] Browser busy, waiting... (Attempt ${attempts})`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 sec
    attempts++;
  }

  if (_browserBusy) {
    throw new Error('Browser is still busy after timeout');
  }

  _browserBusy = true;
  
  try {
    const browser = await getBrowser();
    // Use fresh context for 'Hard Refresh' equivalent if stealth/healing
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'ru-RU'
    });
    
    const pagePromises = urls.map(async (url) => {
      const page = await context.newPage();
      try {
        let activeBase = BASE_URL;
        try {
          const mIdx = await getPersistentMirrorIndex();
          if (mIdx >= 0 && mIdx < MIRRORS.length) {
            activeBase = MIRRORS[mIdx];
          }
        } catch (e) {}
        
        const targetUrl = url.replace(BASE_URL, activeBase);

        if (stealth) {
          console.log(`[Playwright] Stealth sequence for: ${targetUrl}`);
          await page.goto(activeBase, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await page.waitForTimeout(2000);
          // Simulate mouse movement
          await page.mouse.move(Math.random() * 500, Math.random() * 500);
        }

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        try {
          await page.waitForSelector('.my_razdel.film', { timeout: 10000 });
        } catch (_) {}
        
        const content = await page.content();
        return content;
      } catch (err) {
        console.error(`[Playwright] Error on ${url}:`, err.message);
        return "";
      } finally {
        await page.close();
      }
    });

    const results = await Promise.all(pagePromises);
    await context.close();
    return results;
  } finally {
    _browserBusy = false;
  }
}

async function fetchWithBrowser(url: string): Promise<string> {
  const results = await fetchPagesWithBrowser([url]);
  return results[0];
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase Env Variables in Backend");
}

const filterCache = new Map<string, { data: any, timestamp: number }>();
const FILTER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export const supabase = createClient(
  supabaseUrl || '',
  supabaseKey || ''
);

const app = express();
app.use(cors());
app.use(express.json());

// Middleware to check for required environment variables
app.use((req, res, next) => {
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Backend configuration error" });
  }
  next();
});

const BASE_URL = 'https://mj.anwap.today';
const DEPLOY_TIME = Date.now(); // Force refresh on server start after sequential fix

app.post("/api/history", async (req, res) => {
  const { userId, contentId, type } = req.body;
  if (!userId || !contentId) return res.status(400).json({ error: "Missing data" });

  try {
    await supabase.from('view_history').upsert({
      user_id: userId.toString(),
      content_id: contentId,
      type: type || 'movie',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,content_id' });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("History upsert error:", error.message);
    res.status(500).json({ error: "Failed to save history" });
  }
});

app.get("/api/history/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const { data: history, error } = await supabase
      .from('view_history')
      .select('*')
      .eq('user_id', userId.toString())
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // We also need movie/serial metadata to display.
    // Fetch details for these IDs from content_cache
    const itemIds = history.map(h => h.content_id);
    const { data: items } = await supabase
      .from('content_cache')
      .select('*')
      .in('id', itemIds);

    const fullHistory = history.map(h => {
        const item = items?.find(i => i.id === h.content_id);
        return {
            ...item,
            id: h.content_id,
            type: h.type,
            viewedAt: new Date(h.updated_at).getTime()
        };
    }).filter(h => h.title); // Filter out items not in cache yet

    res.json(fullHistory);
  } catch (error: any) {
    console.error("History fetch error:", error.message);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

/**
 * Returns an array of donor URLs to fetch for aggregation.
 * We aggregate 2 donor pages into 1 app page to provide "full lists".
 */
function getDonorUrls(basePath: string, filter: string | undefined, pageNum: number | string, depth: number = 5): string[] {
  const donorUrls: string[] = [];
  const pNum = Number(pageNum) || 1;
  const startDonorPage = (pNum - 1) * depth + 1;
  const cleanFilter = filter ? filter.split(':')[0] : '';
  
  for (let i = 0; i < depth; i++) {
    const p = startDonorPage + i;
    let donorUrl = "";

    // 1. ТОП Списки (Anwap любит & для пагинации в топах)
    if (["top_likes", "view", "top"].includes(cleanFilter)) {
      const mapping: any = { "top_likes": "like", "view": "", "top": "" };
      const subPath = mapping[cleanFilter];
      const suffix = subPath ? `/${subPath}` : "";
      donorUrl = `${BASE_URL}${basePath}/top${suffix}${p > 1 ? `&${p}` : ''}`;
    } 
    // 2. Коллекции (Через слэш /)
    else if (filter && filter.startsWith('col_')) {
      const colId = filter.substring(4);
      donorUrl = `${BASE_URL}${basePath}/collection/${colId}${p > 1 ? `/${p}` : ''}`;
    } 
    // 3. Жанры и Страны (Через дефис -)
    else if (filter && filter !== 'latest') {
      donorUrl = `${BASE_URL}${basePath}/${filter}${p > 1 ? `-${p}` : ''}`;
    } 
    // 4. Главная (p-)
    else {
      donorUrl = `${BASE_URL}${basePath}/${p > 1 ? `p-${p}` : ''}`;
    }
    
    donorUrls.push(donorUrl);
  }
  console.log(`[DEBUG] Fetching URLs: ${donorUrls.join(', ')}`);
  return donorUrls;
}

const translationCache = new Map<string, string>();
const reverseTranslationCache = new Map<string, string>();

const getCachedContent = async (id: string) => {
  console.log("Connecting to Supabase to get cached content for id:", id);
  try {
    const { data, error } = await supabase
      .from('content_cache')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error || !data) {
      console.log("Cache miss!");
      return null;
    }
    
    // Check if cache is older than 7 days
    const cacheDate = new Date(data.created_at).getTime();
    if (Date.now() - cacheDate > 7 * 24 * 60 * 60 * 1000) {
      console.log("Cache expired!");
      return null;
    }
    
    console.log("Cache hit!");
    return data;
  } catch (e) {
    console.error("Error in getCachedContent:", e);
    return null;
  }
};

const setCachedContent = async (item: any) => {
  console.log("Connecting to Supabase to set cached content for id:", item.id);
  try {
    const payload: any = {
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.desc,
      image_url: item.img,
      rating: item.rating,
      year: item.year,
      genres: item.genres,
      created_at: new Date().toISOString()
    };
    if (item.title_ru !== undefined) payload.title_ru = item.title_ru;
    if (item.desc_ru !== undefined) payload.description_ru = item.desc_ru;
    if (item.genres_ru !== undefined) payload.genres_ru = item.genres_ru;
    
    await supabase.from('content_cache').upsert(payload);
  } catch (e) {
    console.error("Error setting cache:", e);
  }
};

const translateToRussian = async (text: string) => {
  if (!text) return text;
  // If text contains Cyrillic, assume it's already Russian
  if (/[а-яА-ЯёЁ]/.test(text)) return text;
  
  if (reverseTranslationCache.has(text)) return reverseTranslationCache.get(text)!;
  
  try {
    const res = await translate(text, { to: 'ru', tld: 'com' });
    const translated = res.text;
    reverseTranslationCache.set(text, translated);
    return translated;
  } catch (error) {
    console.error("Reverse translation error:", error);
    return text;
  }
};

const sanitizeTitle = (title: string) => {
  return title
    // Remove trailer/preview/teaser words (Russian and English)
    .replace(/(трейлер|превью|тизер|trailer|preview|teaser)/gi, "")
    // Remove duration patterns like "(1 min.)", "(2 мин.)", "(1:30)"
    .replace(/\(\s*\d+[\s:.,]*(мин\.?|min\.?|сек\.?|sec\.?|s|m)?\s*\)/gi, "")
    // Remove common junk words
    .replace(/(смотреть|онлайн|фильм|сериал|бесплатно|в хорошем качестве|hd|720p|1080p|\d{4} года|\d{4})/gi, "")
    // Remove "Искать трейлер" and similar phrases
    .replace(/(искать\s*(трейлер|trailer))/gi, "")
    // Clean up trailing colons, dashes, dots, and extra punctuation
    .replace(/[\s:;\-–—.,!]+$/g, "")
    // Clean up leading colons, dashes
    .replace(/^[\s:;\-–—.,!]+/g, "")
    // Collapse multiple spaces
    .replace(/\s+/g, " ")
    .trim();
};

const cleanDownloadText = (text: string) => {
  if (!text) return "";
  return text
    .replace(/Скачать/gi, "Download")
    .replace(/мб\.?/gi, "MB")
    .replace(/гб\.?/gi, "GB")
    .replace(/кб\.?/gi, "KB")
    .replace(/тб\.?/gi, "TB")
    .replace(/с переводом/gi, "with translation")
    .replace(/оригинал/gi, "original")
    .replace(/сезон/gi, "season")
    .replace(/серия/gi, "episode")
    .replace(/Дубляж/gi, "Dubbed")
    .replace(/Проф\./gi, "Prof.")
    .replace(/Многоголосый/gi, "Multi-voice");
};

const batchTranslate = async (items: string[]) => {
  if (!items || items.length === 0) return [];
  
  const results = new Array(items.length).fill(null);
  const toTranslate: { text: string, index: number }[] = [];

  const TITLE_CORRECTIONS: Record<string, string> = {
    "Scarvigolova": "Daredevil",
    "Scarhead": "Daredevil",
    "Сорвиголова": "Daredevil",
    "Van Pis": "One Piece",
    "Van-Pis": "One Piece",
    "One-Pis": "One Piece",
    "Ван-Пис": "One Piece",
    "Got": "Game of Thrones",
    "Игра престолов": "Game of Thrones",
    "the mentalist": "The Mentalist"
  };

  items.forEach((item, index) => {
    // Check corrections first to avoid remote call
    const correction = TITLE_CORRECTIONS[item] || TITLE_CORRECTIONS[item.toLowerCase()];
    if (correction) {
      results[index] = correction;
    } else if (translationCache.has(item)) {
      results[index] = translationCache.get(item)!;
    } else {
      toTranslate.push({ text: item, index });
    }
  });

  if (toTranslate.length > 0) {
    let res: any;
    try {
      const textsToTranslate = toTranslate.map(t => t.text);
      res = await translate(textsToTranslate, { to: 'en', rejectOnPartialFail: false, tld: 'com' });
    } catch (error) {
      console.warn("Translation with tld: 'com' failed, trying fallback...", error);
      try {
        const textsToTranslate = toTranslate.map(t => t.text);
        res = await translate(textsToTranslate, { to: 'en', rejectOnPartialFail: false }); // default TLD
      } catch (innerError) {
        console.error("All translation attempts failed, returning original text:", innerError);
        // Fall back to original text — do NOT throw, so the caller always gets data
        toTranslate.forEach(t => {
          results[t.index] = t.text;
          translationCache.set(t.text, t.text);
        });
        res = null;
      }
    }

    if (res) {
      const translatedArray = Array.isArray(res) ? res : [res];
      
      translatedArray.forEach((r: any, i: number) => {
        const translatedText = r?.text || toTranslate[i].text;
        const originalIndex = toTranslate[i].index;
        results[originalIndex] = translatedText;
        translationCache.set(toTranslate[i].text, translatedText);
      });
    }
  }

  // Ensure all results are populated and properly capitalized
  items.forEach((item, index) => {
    if (results[index] === null) {
      results[index] = item;
    }
    // Simple capitalization for short strings (titles)
    if (typeof results[index] === 'string' && results[index].length < 100) {
       const str = results[index] as string;
       results[index] = str.charAt(0).toUpperCase() + str.slice(1);
    }
  });

  return results;
};

const MIRRORS = [
  "https://mj.anwap.today",
  "https://anwap.video",
  "https://mi.anwap.mobi",
  "https://tv.anwap.today"
];

const getPersistentMirrorIndex = async (): Promise<number> => {
  try {
    const { data } = await supabase
      .from('content_cache')
      .select('title')
      .eq('id', 'system:mirror_state')
      .single();
    return data ? parseInt(data.title) : 0;
  } catch (e) {
    return 0;
  }
};

const setPersistentMirrorIndex = async (index: number) => {
  try {
    await supabase.from('content_cache').upsert({
      id: 'system:mirror_state',
      type: 'system',
      title: index.toString(),
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error("Error saving mirror state:", e);
  }
};

let globalSessionCache: { cookie: string, expiry: number } | null = null;

const getSavedSession = async (): Promise<string | null> => {
  // Check memory cache first (1 hour expiry)
  if (globalSessionCache && globalSessionCache.expiry > Date.now()) {
    return globalSessionCache.cookie;
  }

  try {
    const { data } = await supabase
      .from('content_cache')
      .select('description')
      .eq('id', 'system:session_cookie')
      .single();
    
    if (data && data.description) {
      globalSessionCache = {
        cookie: data.description,
        expiry: Date.now() + 3600 * 1000 // Cache for 1 hour
      };
      return data.description;
    }
    return null;
  } catch (e) {
    return null;
  }
};

const saveSession = async (cookie: string) => {
  globalSessionCache = {
    cookie,
    expiry: Date.now() + 3600 * 1000
  };
  try {
    await supabase.from('content_cache').upsert({
      id: 'system:session_cookie',
      type: 'system',
      description: cookie,
      created_at: new Date().toISOString()
    });
  } catch (e) {
    console.error("Error saving session cookie:", e);
  }
};

const fetchHtml = async (url: string, retries = 3): Promise<string> => {
  console.log("[fetchHtml] Navigating to:", url);
  
  const baseHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Cache-Control": "max-age=0",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"'
  };

  const httpsAgent = new https.Agent({ 
    rejectUnauthorized: false,
    keepAlive: true 
  });

  const savedSession = await getSavedSession();
  
  const tryFetch = async (targetUrl: string, useSession = true) => {
    const headers = { ...baseHeaders };
    // Always include a Referer to mimic browser behavior
    try {
      const url = new URL(targetUrl);
      headers["Referer"] = `${url.origin}/`;
    } catch (e) {}

    // Only use session for specific deep-links or internal actions, 
    // never for public category/filter lists to avoid bot-detect redirects.
    const isPublicList = targetUrl.includes('/films/') || targetUrl.includes('/serials/');
    if (useSession && savedSession && !isPublicList) {
       headers["Cookie"] = savedSession;
    }
    return await axios.get(targetUrl, {
      headers,
      httpsAgent,
      responseType: 'arraybuffer',
      timeout: 15000,
      validateStatus: (status) => status < 400 || status === 403
    });
  };

  // Get mirror order starting with last working one
  const lastIndex = await getPersistentMirrorIndex();
  let mirrorOrder = [...MIRRORS];
  if (lastIndex > 0 && lastIndex < MIRRORS.length) {
    const [working] = mirrorOrder.splice(lastIndex, 1);
    mirrorOrder.unshift(working);
  }

  let lastError: any = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const isAnwap = url.includes('anwap');
    const currentMirrorOrder = isAnwap ? mirrorOrder : [url];

    for (const mirrorOrUrl of currentMirrorOrder) {
      let targetUrl = "";
      
      try {
        const originalUrl = new URL(url);
        const mirrorUrl = new URL(mirrorOrUrl);
        // Replace origin with mirror, keep path, search, hash
        targetUrl = `${mirrorUrl.origin}${originalUrl.pathname}${originalUrl.search}${originalUrl.hash}`;
      } catch (e) {
        // Fallback for non-URL inputs or simple strings
        targetUrl = mirrorOrUrl;
      }

      try {
        console.log(`[fetchHtml] Attempting fetch: ${targetUrl}`);
        const response = await tryFetch(targetUrl);
        console.log(`[fetchHtml] Response Status: ${response.status}, Final URL: ${response.request?.res?.responseUrl || targetUrl}`);
        
        const responseUrl = (response.request?.res?.responseUrl || targetUrl).toLowerCase();
        const urlObj = new URL(responseUrl);
        const requestedUrl = new URL(targetUrl);
        
        // Normalize paths for comparison (remove trailing slashes)
        const requestedPath = requestedUrl.pathname.toLowerCase().replace(/\/$/, "");
        const actualPath = urlObj.pathname.toLowerCase().replace(/\/$/, "");

        // Bot-block redirect: land on a home page instead of requested deep path
        if (actualPath !== requestedPath) {
           const isBaseRequest = requestedPath === "" || requestedPath === "/films" || requestedPath === "/serials";
           if (!isBaseRequest) {
             console.warn(`[fetchHtml] Redirect detected: ${requestedPath} -> ${actualPath}. Retrying...`);
             throw new Error(`Bot-block: Redirect from ${requestedPath} to ${actualPath}`);
           }
        }
        
        // Handle set-cookie if present
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
           const phpSessId = setCookie.find(c => c.startsWith('PHPSESSID='));
           if (phpSessId) {
             const cookieValue = phpSessId.split(';')[0];
             await saveSession(cookieValue);
           }
        }

        if (response.status === 403) throw new Error('403 Forbidden');
        
        // Smart encoding detection
        const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
        const contentType = response.headers['content-type']?.toLowerCase() || "";
        let charset = "windows-1251";
        if (contentType.includes("charset=utf-8")) {
          charset = "utf-8";
        } else {
          const head = buffer.slice(0, 1024).toString('ascii');
          if (head.includes('charset=utf-8') || head.includes('charset="utf-8"')) {
            charset = "utf-8";
          }
        }

        const decoder = new TextDecoder(charset);
        const html = decoder.decode(buffer);
        
        console.log(`[fetchHtml] Fetched ${responseUrl}, charset: ${charset}, length: ${html.length}`);
        
        const currentIndex = MIRRORS.indexOf(mirrorOrUrl);
        if (currentIndex !== -1 && currentIndex !== lastIndex) {
          await setPersistentMirrorIndex(currentIndex);
        }
        return html;
      } catch (error: any) {
        lastError = error;
        console.warn(`Mirror ${mirrorOrUrl} failed: ${error.message}`);
      }
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  
  throw lastError || new Error(`Failed to fetch ${url} after ${retries} attempts and all mirrors.`);
};


// API routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/user/me", express.json(), async (req, res) => {
  try {
    const { id, username, first_name, avatar_url } = req.body;
    if (!id) return res.status(400).json({ error: "ID is required" });

    console.log("Connecting to Supabase to upsert profile for id:", id);
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id,
        username,
        first_name,
        avatar_url,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error("User profile sync error:", error.message);
    res.status(500).json({ error: "Failed to sync user profile" });
  }
});

app.post("/api/profile/sync", express.json(), async (req, res) => {
  try {
    const { id, username, first_name, avatar_url } = req.body;
    if (!id) return res.status(400).json({ error: "ID is required" });

    console.log("Connecting to Supabase to sync profile for id:", id);
    
    // First, try to get existing profile to preserve is_premium status
    const { data: existing } = await supabase
      .from('profiles')
      .select('is_premium')
      .eq('id', id)
      .single();

    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id,
        username,
        first_name,
        avatar_url,
        is_premium: existing?.is_premium || false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error("Profile sync error:", error.message);
    res.status(500).json({ error: "Failed to sync profile" });
  }
});

app.get("/api/movies/popular", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const url = page === 1 ? `${BASE_URL}/films/top` : `${BASE_URL}/films/top&${page}`;
  const cacheId = `list:${url}`;
  
  try {
    const { data: cached } = await supabase.from('content_cache').select('*').eq('id', cacheId).single();
    if (cached) {
      const isStale = Date.now() - new Date(cached.created_at).getTime() > 24 * 60 * 60 * 1000;
      if (!isStale) return res.json({ items: JSON.parse(cached.description) });
      
      res.json({ items: JSON.parse(cached.description) });
      (async () => {
        try {
          const freshHtml = await fetchHtml(url);
          const freshItems = parseItems(freshHtml, 'movie');
          const processedItems = await processItems(freshItems);
          await supabase.from('content_cache').upsert({
            id: cacheId,
            type: 'list',
            description: JSON.stringify(processedItems),
            created_at: new Date().toISOString()
          });
        } catch (e) { console.error("Popular movies refresh failed:", e); }
      })();
      return;
    }

    const html = await fetchHtml(url);
    const items = parseItems(html, 'movie');
    const processedItems = await processItems(items);
    await supabase.from('content_cache').upsert({
      id: cacheId,
      type: 'list',
      description: JSON.stringify(processedItems),
      created_at: new Date().toISOString()
    });
    res.json({ items: processedItems });
  } catch (error: any) {
    console.error("Error fetching popular movies:", error.message);
    res.status(500).json({ error: "Failed to fetch popular movies" });
  }
});

app.get("/api/serials/popular", async (req, res) => {
  const page = Number(req.query.page) || 1;
  const url = page === 1 ? `${BASE_URL}/serials/top` : `${BASE_URL}/serials/top&${page}`;
  const cacheId = `list:${url}`;

  try {
    const bypassCache = req.query.cache === '0';
    const { data: cached } = await supabase.from('content_cache').select('*').eq('id', cacheId).single();
    if (cached && !bypassCache) {
      const isStale = Date.now() - new Date(cached.created_at).getTime() > 24 * 60 * 60 * 1000;
      if (!isStale) return res.json({ items: JSON.parse(cached.description) });
      
      res.json({ items: JSON.parse(cached.description) });
      (async () => {
        try {
          const freshHtml = await fetchHtml(url);
          const freshItems = parseItems(freshHtml, 'serial');
          const processedItems = await processItems(freshItems);
          await supabase.from('content_cache').upsert({
            id: cacheId,
            type: 'list',
            description: JSON.stringify(processedItems),
            created_at: new Date().toISOString()
          });
        } catch (e) { console.error("Popular serials refresh failed:", e); }
      })();
      return;
    }

    const html = await fetchHtml(url);
    const items = parseItems(html, 'serial');

    // Heuristic: Inject Game of Thrones if missing from popular list
    if (page === 1 && !items.find(i => i.id === '8' || i.title.includes('Игра престолов'))) {
      try {
        const gotHtml = await fetchWithBrowser(`${BASE_URL}/serials/8`);
        if (gotHtml) {
          const $ = cheerio.load(gotHtml);
          const title = $(".acat").first().contents().filter((i, el) => el.type === 'text').first().text().trim();
          const img = $(".filmscreen").attr("src");
          const rating = $(".rei").text().trim() || "9.0";
          const year = "2011";
          const genres = ["Фэнтези", "Драма"];
          
          items.unshift({
            id: '8',
            title,
            img: img?.startsWith('http') ? img : BASE_URL + img,
            rating,
            year,
            genres,
            desc: "Игра Престолов основана на серии книг Джорджа Р. Р. Мартина..."
          });
        }
      } catch (e) {
        console.warn("Heuristic injection for GOT failed:", e);
      }
    }

    const processedItems = await processItems(items);
    await supabase.from('content_cache').upsert({
      id: cacheId,
      type: 'list',
      description: JSON.stringify(processedItems),
      created_at: new Date().toISOString()
    });
    res.json({ items: processedItems });
  } catch (error: any) {
    console.error("Error fetching popular serials:", error.message);
    res.status(500).json({ error: "Failed to fetch popular serials" });
  }
});

app.get("/api/details/movies/:id/watch", async (req, res) => {
  const { id } = req.params;
  const lang = (req.query.lang as string) || 'ru';
  
  try {
    // JIT: Directly fetch fresh link for every click to avoid 410 Gone
    const data = await scrapeMovieEmbed(id, lang);
    res.json(data);
  } catch (error: any) {
    console.error("Error fetching movie watch link:", error.message);
    res.status(500).json({ error: "Failed to fetch watch link" });
  }
});

const extractDirectLink = async (embedUrl: string) => {
  console.log("[extractDirectLink] Attempting extraction from:", embedUrl);
  try {
    const html = await fetchHtml(embedUrl);
    
    // Pattern 1: HLS/MP4 in script strings
    const urlPattern = /['"]?(https?:[^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/gi;
    const matches = [...html.matchAll(urlPattern)];
    
    // Filter and find the best candidate
    const candidates = matches
      .map(m => m[1])
      .filter(url => !url.includes('ads') && !url.includes('pixel') && !url.includes('google'));

    if (candidates.length > 0) {
      // Prefer m3u8 over mp4 for better streaming
      const best = candidates.find(url => url.includes('.m3u8')) || candidates[0];
      console.log("[extractDirectLink] Found candidates:", candidates.length, "Best choice:", best.substring(0, 50) + "...");
      return best;
    }

    // Pattern 2: Look for common player config object (file: "...", source: "...", hls: "...", etc.)
    const configPattern = /(?:file|source|src|url|hls)\s*[:=]\s*['"]([^'"]+)['"]/gi;
    const configMatches = [...html.matchAll(configPattern)];
    const configCandidates = configMatches
      .map(m => m[1])
      .filter(url => url.startsWith('http') && (url.includes('.m3u8') || url.includes('.mp4')));

    if (configCandidates.length > 0) {
      console.log("[extractDirectLink] Found config candidates:", configCandidates[0].substring(0, 50) + "...");
      return configCandidates[0];
    }

    console.warn("[extractDirectLink] No direct link found. HTML length:", html.length);
  } catch (e: any) {
    console.warn("[extractDirectLink] Failed to extract from:", embedUrl, "Error:", e.message);
  }
  return null;
};

const extractAnwapVideoUrlWithPlaywright = async (url: string): Promise<string> => {
  let videoUrl = "";
  let attempts = 0;
  while (_browserBusy && attempts < 30) {
    await new Promise(r => setTimeout(r, 1000));
    attempts++;
  }
  _browserBusy = true;
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    
    page.on('request', request => {
      const reqUrl = request.url();
      if ((reqUrl.includes('.m3u8') || reqUrl.includes('.mp4')) && !reqUrl.includes('ads') && !reqUrl.includes('google')) {
        if (!videoUrl) videoUrl = reqUrl;
      }
    });

    try {
      let activeBase = BASE_URL;
      try {
        const mIdx = await getPersistentMirrorIndex();
        if (mIdx >= 0 && mIdx < MIRRORS.length) {
          activeBase = MIRRORS[mIdx];
        }
      } catch (e) {}
      const finalUrl = url.replace(BASE_URL, activeBase);
      
      console.log(`[Playwright] Extracting video URL from: ${finalUrl}`);
      await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
    } catch(e) {}
    
    await page.close();
    await context.close();
  } catch(e) {
    console.error("[extractAnwapVideoUrlWithPlaywright] Error:", e);
  } finally {
    _browserBusy = false;
  }
  return videoUrl;
};

const scrapeMovieEmbed = async (id: string, lang: string = 'ru') => {
  const url = `${BASE_URL}/films/${id}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  
  const iframeSrcRegex = html.match(/iframe\.src\s*=\s*['"]([^'"]+)['"]/);
  let src = "";
  if (iframeSrcRegex && iframeSrcRegex[1]) {
    src = iframeSrcRegex[1];
  } else {
    src = $("iframe").attr("src") || "";
  }

  if (!src) {
    console.warn("[scrapeMovieEmbed] Embed URL not found for ID:", id, "Using Playwright to extract direct video link...");
    const videoUrl = await extractAnwapVideoUrlWithPlaywright(url);
    if (!videoUrl) {
      throw new Error("Embed URL and Video URL not found");
    }
    return { embedUrl: "", videoUrl }; // Frontend uses videoUrl directly
  }

  let finalSrc = src.startsWith('http') ? src : (src.startsWith('//') ? 'https:' + src : BASE_URL + src);
  
  // Mirror active origin replacement
  if (finalSrc.includes('anwap')) {
    try {
      const mirrorIdx = await getPersistentMirrorIndex();
      const mirrorUrl = new URL(MIRRORS[mirrorIdx]);
      const currentUrl = new URL(finalSrc);
      finalSrc = `${mirrorUrl.origin}${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    } catch (e) {}
  }

  // Attempt to bypass Anwap iframe ads by extracting direct .mp4 or .m3u8 URL
  const directLink = await extractDirectLink(finalSrc);
  if (directLink) {
    return { embedUrl: "", videoUrl: directLink };
  }

  const params = `track=Eng.Original&audio=original&voice=original&translation=original&lang=${(lang || "ru").startsWith("en") ? "en" : "ru"}&language=${(lang || "ru").startsWith("en") ? "en" : "ru"}&locale=${(lang || "ru").startsWith("en") ? "en" : "ru"}&translation_type=original&sound=original&v=1&ads=0`;
  const shareParams = 'share=0&social=0&without_vk=1&without_ok=1&hide_share=vk,ok,fb,tw&hide_social=vk,ok,fb,tw&share_list=telegram,facebook';
  finalSrc += (finalSrc.includes('?') ? '&' : '?') + params + '&' + shareParams;
  
  return { embedUrl: finalSrc, videoUrl: "" };
};

app.get("/api/details/serials/:id/watch", async (req, res) => {
  const { id } = req.params;
  const lang = (req.query.lang as string) || 'ru';
  
  try {
    // JIT: Directly fetch fresh link for every click to avoid 410 Gone
    const data = await scrapeSerialEmbed(id, lang);
    res.json(data);
  } catch (error: any) {
    console.error("Error fetching serial watch link:", error.message);
    res.status(500).json({ error: "Failed to fetch watch link" });
  }
});

const scrapeSerialEmbed = async (id: string, lang: string = 'ru') => {
  const serialUrl = `${BASE_URL}/serials/${id}`;
  const serialHtml = await fetchHtml(serialUrl);
  const serialMatch = serialHtml.match(/href=\"(\/serials\/s\d+)\"/);
  
  let seasonHtml = serialHtml;
  if (serialMatch && serialMatch[1]) {
    const seasonUrl = `${BASE_URL}${serialMatch[1]}`;
    seasonHtml = await fetchHtml(seasonUrl);
  } else {
    console.warn(`[scrapeSerialEmbed] Season not found for ${id}, attempting to find episodes directly`);
  }
  
  const episodeMatch = seasonHtml.match(/href=\"(\/serials\/down\/\d+)\"/);
  
  if (!episodeMatch || !episodeMatch[1]) {
    throw new Error("Episode not found");
  }
  
  const episodeUrl = `${BASE_URL}${episodeMatch[1]}`;
  const episodeHtml = await fetchHtml(episodeUrl);
  const $e = cheerio.load(episodeHtml);
  
  const iframeSrcRegex = episodeHtml.match(/iframe\.src\s*=\s*['"]([^'"]+)['"]/);
  let src = "";
  if (iframeSrcRegex && iframeSrcRegex[1]) {
    src = iframeSrcRegex[1];
  } else {
    src = $e("iframe").attr("src") || "";
  }

  if (!src) {
    console.warn("[scrapeSerialEmbed] Embed URL not found for episode. Using Playwright fallback...");
    const videoUrl = await extractAnwapVideoUrlWithPlaywright(episodeUrl);
    if (!videoUrl) throw new Error("Embed URL and Video URL not found");
    return { embedUrl: "", videoUrl };
  }

  let finalSrc = src.startsWith('http') ? src : (src.startsWith('//') ? 'https:' + src : BASE_URL + src);

  // Mirror active origin replacement
  if (finalSrc.includes('anwap')) {
    try {
      const mirrorIdx = await getPersistentMirrorIndex();
      const mirrorUrl = new URL(MIRRORS[mirrorIdx]);
      const currentUrl = new URL(finalSrc);
      finalSrc = `${mirrorUrl.origin}${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    } catch (e) {}
  }

  const params = `track=Eng.Original&audio=original&voice=original&translation=original&lang=${(lang || "ru").startsWith("en") ? "en" : "ru"}&language=${(lang || "ru").startsWith("en") ? "en" : "ru"}&locale=${(lang || "ru").startsWith("en") ? "en" : "ru"}&translation_type=original&sound=original`;
  const shareParams = 'share=0&social=0&without_vk=1&without_ok=1&hide_share=vk,ok,fb,tw&hide_social=vk,ok,fb,tw&share_list=telegram,facebook';
  finalSrc += (finalSrc.includes('?') ? '&' : '?') + params + '&' + shareParams;
  
  const videoUrl = await extractDirectLink(finalSrc);
  if (videoUrl) {
    return { embedUrl: "", videoUrl };
  }
  return { embedUrl: finalSrc, videoUrl: "" };
};

app.get("/api/filters/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const lang = (req.query.lang as string) || 'ru';
    const cacheKey = `${type}:${lang}`;
    
    // Check memory cache
    const cached = filterCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < FILTER_CACHE_TTL)) {
      return res.json(cached.data);
    }

    let basePath = "";
    if (type === "movies") basePath = "/films";
    else if (type === "serials") basePath = "/serials";
    else return res.status(400).json({ error: "Invalid type" });

    let genres: any[] = [];
    let countries: any[] = [];
    let collections: any[] = [];

    // Fetch genres
    try {
      const genreHtml = await fetchHtml(`${BASE_URL}${basePath}/genre`);
      console.log(`[DEBUG] Fetched ${basePath}/genre, length: ${genreHtml.length}`);
      const $g = cheerio.load(genreHtml);
      const allLinks = $g("a");
      console.log(`[scraper] Found ${allLinks.length} links on genre page`);
      allLinks.each((_, el) => {
        const href = $g(el).attr("href");
        let text = $g(el).text().trim();
        const match = href?.match(/(?:^|\/|[?&])r(\d+)(?:\/|&|$)/);
        if (match) {
           // Skip common false positives
           if (href.includes('search') || href.includes('comment') || href.includes('slv=')) return;
           
           text = text.replace(/^\d+\s/, '').replace(/^(Genre|Genres|Жанр|Жанры):?\s*/i, '').trim();
           const id = 'r' + match[1];
           if (id && text && !genres.find(g => g.id === id)) {
              genres.push({ id, name: text });
           }
        }
      });
    } catch (e) {
      console.error(`Error fetching genres for ${type}:`, e);
    }

    // Fetch countries
    try {
      const countryHtml = await fetchHtml(`${BASE_URL}${basePath}/countries`);
      const $c = cheerio.load(countryHtml);
      $c("a").each((_, el) => {
        const href = $c(el).attr("href");
        let text = $c(el).text().trim();
        const match = href?.match(/(?:^|\/|[?&])c(\d+)(?:\/|&|$)/);
        if (match && !href.includes('search')) {
          text = text.replace(/^\d+\s/, '').replace(/^(Country|Countries|Страна|Страны):?\s*/i, '').trim();
          const id = 'c' + match[1];
          if (id && text && !countries.find(c => c.id === id)) {
            countries.push({ id, name: text });
          }
        }
      });
    } catch (e) {
      console.error(`Error fetching countries for ${type}:`, e);
    }

    // Fetch collections
    try {
      const colHtml = await fetchHtml(`${BASE_URL}${basePath}/collections`);
      const $col = cheerio.load(colHtml);
      $col("a").each((_, el) => {
        const href = $col(el).attr("href");
        let text = $col(el).text().trim();
        const match = href?.match(/(?:^|\/|[?&])collection\/(\d+)(?:\/|&|$)/);
        if (match) {
          const id = match[1];
          if (id && !collections.find(c => c.id === id)) {
             const parts = text.split('\n');
             let name = parts.length > 1 ? parts[1].trim() : text;
             name = name.replace(/^(Collection|Collections|Коллекция|Коллекции):?\s*/i, '').trim();
             if (name) collections.push({ id, name });
          }
        }
      });
    } catch (e) {
      console.error(`Error fetching collections for ${type}:`, e);
    }

    // Final Fallbacks removed as per user request to use donor site only
    if (genres.length === 0 && (type === 'movies' || type === 'serials')) {
       console.warn(`[API] Scraper failed to find any genres for ${type} after trying all mirrors.`);
    }

    // Only translate if actually requested and English
    if (lang.startsWith('en')) {
      const allNames = [
        ...genres.map(g => g.name),
        ...countries.map(c => c.name),
        ...collections.map(col => col.name)
      ];
      
      if (allNames.length > 0) {
        const translatedNames = await batchTranslate(allNames);
        let idx = 0;
        genres.forEach(g => g.name = translatedNames[idx++]);
        countries.forEach(c => c.name = translatedNames[idx++]);
        collections.forEach(col => col.name = translatedNames[idx++]);
      }
    }

    const result = { genres, countries, collections };
    filterCache.set(cacheKey, { data: result, timestamp: Date.now() });
    res.json(result);
  } catch (error: any) {
    console.error("Error fetching filters:", error.message);
    res.status(500).json({ error: "Failed to fetch filters" });
  }
});


app.get("/api/movies", async (req, res) => {
  let url = "";
  try {
    const page = req.query.page || 1;
    let search = req.query.search as string;
    const filter = req.query.filter as string;
    const pageNum = Number(page);
    const basePath = "/films";
    
    // Aggregate for all non-search requests
    const isAggregated = !search;
    const isTopList = ["top_likes", "top", "view"].includes(filter);

    if (search) {
      url = `${BASE_URL}${basePath}/search/?slv=${encodeURIComponent(search)}&vid=1&page=${page}`;
    } else {
      const donorUrls = getDonorUrls(basePath, filter, pageNum, 5);
      url = donorUrls[0] + "_agg5"; // Updated to _agg5 for depth 5
    }

    console.log(`[API] Fetching movies for filter "${filter || 'latest'}", page ${page}. URL: ${url}`);
    const cacheId = `list:${url}`;
    
    // SWR Logic: Check cache first
    const { data: cachedList } = await supabase
      .from('content_cache')
      .select('*')
      .eq('id', cacheId)
      .single();

    if (cachedList) {
      let items = [];
      try { items = JSON.parse(cachedList.description); } catch (e) {}
      const isEmpty = Array.isArray(items) && items.length === 0;
      const cacheTime = new Date(cachedList.created_at).getTime();
      const isDeploymentStale = cacheTime < DEPLOY_TIME;
      const isAgeStale = Date.now() - cacheTime > 24 * 60 * 60 * 1000;
      
      if (!isAgeStale && !isDeploymentStale && !isEmpty) {
        console.log("Returning fresh cached list for:", url);
        return res.json({ items });
      }

      // If deployment is stale OR list is empty, we MUST await refresh
      if (isDeploymentStale || isEmpty) {
        console.log(`[Urgent] Deployment stale or empty for movies: ${url}`);
      } else {
        console.log(`[Passive] Age stale, returning old movies and refreshing: ${url}`);
        res.json({ items });
        // Background Refresh
        (async () => {
          try {
            let freshItems: any[] = [];
            if (isAggregated) {
              const donorUrlsLists = getDonorUrls(basePath, filter, pageNum, 5);
              const htmlPages = await fetchPagesWithBrowser(donorUrlsLists, isTopList);
              htmlPages.forEach(h => { if (h) freshItems = [...freshItems, ...parseItems(h, 'movie')]; });
            } else {
              freshItems = parseItems(await fetchHtml(url), 'movie');
            }

            const processedItems = await processItems(freshItems);
            if (processedItems.length > 0) {
              await supabase.from('content_cache').upsert({ id: cacheId, type: 'list', description: JSON.stringify(processedItems), created_at: new Date().toISOString() });
            }
          } catch (e) {}
        })();
        return;
      }
    }

    let items: any[] = [];
    
    try {
      if (isAggregated) {
        const donorUrls = getDonorUrls(basePath, filter, pageNum, 5);
        // Force stealth Playwright for top lists OR if no search (depth 5 case)
        const htmlPages = await fetchPagesWithBrowser(donorUrls, isTopList);
        
        htmlPages.forEach(h => {
          if (h) items = [...items, ...parseItems(h, 'movie')];
        });

      } else {
        const html = await fetchHtml(url);
        items = parseItems(html, 'movie');
      }
    } catch (subError: any) {
      console.error(`[API] Sub-fetch error: ${subError.message}`);
      return res.json({ items: [] });
    }

    const processedItems = await processItems(items);
    const junkRegex = /телефон|phone|anwap|online|скачать|мобильн/i;
    const finalClean = processedItems.filter((i: any) => !junkRegex.test(i.title) && !junkRegex.test(i.title_ru || ""));
    res.json({ items: finalClean });
  } catch (error: any) {
    console.error("Error fetching movies. URL:", url || "unknown");
    console.error("Error details:", error.message);
    res.status(500).json({ error: "Failed to fetch movies" });
  }
});

// Helper to parse items from HTML
const parseItems = (html: string, type: 'movie' | 'serial') => {
  const $ = cheerio.load(html);
  const items: any[] = [];
  $(".my_razdel.film").each((_, el) => {
    const a = $(el).find("a").first();
    const href = a.length > 0 ? a.attr("href") : undefined;
    const id = href?.split("/").pop();
    const imgElement = $(el).find("img.screenf");
    const img = imgElement.length > 0 ? imgElement.attr("src") : undefined;
    const titleElement = $(el).find(".namefilm").first();
    const title = titleElement.length > 0 ? titleElement.text().trim() : '';
    
    if (_ === 0) console.log(`[parseItems] Identified first item title: "${title}" for type: ${type}`);
    
    const rating = $(el).find(".rei").text()?.trim() || "";
    // Extract likes count for custom "Top by Likes" display
    const likes = $(el).find(".flike, .in.blue").first().text()?.trim() || "";
    
    const year = $(el).find(".in.year").text()?.trim() || "";
    const genres = $(el).find(".in.genre").map((_, g) => $(g).text()?.trim() || "").get();
    const desc = $(el).find(".discripfilm").text()?.trim() || "";
    
    if (id && title) {
      // Final Content Audit: Strict check to exclude navigation/junk labels
      const junkRegex = /скачать|телефон|phone|anwap|online|бесплатно|мобильн/i;
      const isJunk = title.length < 2 || 
                     junkRegex.test(title) ||
                     !img ||
                     img.includes('undefined') || 
                     !id.match(/^\d+$/);

      if (!isJunk) {
        // Safety: Prevent 'undefined' in image URLs
        const finalImg = img && img !== 'undefined'
          ? (img.startsWith('http') ? img : BASE_URL + img)
          : 'https://placehold.co/400x600/000000/FFFFFF?text=No+Image';

        items.push({ 
          id, 
          title, 
          img: finalImg, 
          rating, 
          likes,
          year, 
          genres, 
          desc, 
          type 
        });
      } else {
        if (_ === 0) console.log(`[parseItems] Skipping junk item: "${title}" (ID: ${id})`);
      }
    }
  });
  return items;
};

// Helper to process items (cache check, translation, etc.)
const processItems = async (items: any[]) => {
  const ids = items.map(i => i.id);
  const { data: cachedItems } = await supabase.from('content_cache').select('*').in('id', ids);
  const cacheMap = new Map(cachedItems?.map(i => [i.id, i]) || []);

  const itemsToTranslate: any[] = [];
  const resultItems = [...items];

  resultItems.forEach((item, idx) => {
    const cached = cacheMap.get(item.id) as any;
    if (cached) {
      resultItems[idx] = {
        ...item,
        title: cached.title,
        desc: cached.description,
        title_ru: cached.title_ru || item.title,
        desc_ru: cached.description_ru || item.desc,
        img: cached.image_url || item.img,
        rating: cached.rating || item.rating,
        year: cached.year || item.year,
        genres: cached.genres || item.genres,
        genres_ru: cached.genres_ru || item.genres,
        likes: item.likes || cached.likes || ""
      };
    } else {
      itemsToTranslate.push({ item, idx });
    }
  });

  if (itemsToTranslate.length > 0) {
    const allTitles = itemsToTranslate.map(it => sanitizeTitle(it.item.title));
    const allDescs = itemsToTranslate.map(it => it.item.desc || "");
    const allGenres = itemsToTranslate.flatMap(it => it.item.genres || []);
    const uniqueGenres = Array.from(new Set(allGenres));
    
    const [translatedTitles, translatedDescs, translatedGenres] = await Promise.all([
      batchTranslate(allTitles),
      batchTranslate(allDescs),
      batchTranslate(uniqueGenres)
    ]);
    
    const genreMap = new Map(uniqueGenres.map((g, i) => [g, translatedGenres[i]]));
    
    itemsToTranslate.forEach((it, i) => {
      const item = resultItems[it.idx];
      // Save original RU text before overwriting
      item.title_ru = sanitizeTitle(item.title);
      item.desc_ru = item.desc || "";
      if (item.genres) {
          item.genres_ru = [...item.genres];
      }
      
      item.title = translatedTitles[i];
      item.desc = translatedDescs[i];
      if (item.genres) {
        item.genres = item.genres.map((g: string) => genreMap.get(g) || g);
      }
      setCachedContent(item);
    });
    const junkRegex = /телефон|phone|anwap|online|скачать|мобильн/i;
    return resultItems.filter(item => {
      const isJunk = junkRegex.test(item.title) || (item.title_ru && junkRegex.test(item.title_ru));
      if (isJunk) console.log(`[processItems] Post-filter junk: "${item.title}"`);
      return !isJunk;
    });
  }
  
  const junkRegexFinal = /телефон|phone|anwap|online|скачать|мобильн/i;
  return resultItems.filter(item => !junkRegexFinal.test(item.title) && !junkRegexFinal.test(item.title_ru || ""));
};

app.get("/api/serials", async (req, res) => {
  let url = "";
  try {
    const page = req.query.page || 1;
    let search = req.query.search as string;
    const filter = req.query.filter as string;
    
    if (search) {
      search = await translateToRussian(search);
    }
    
    const pageNum = Number(page);
    const basePath = "/serials";
    
    // Aggregate all filter lists for "full lists" experience
    const isAggregatedS = !search;
    const isTopListS = ["top_likes", "top", "view"].includes(filter);

    if (search) {
      url = `${BASE_URL}${basePath}/search/?word=${encodeURIComponent(search)}&vid=1&page=${page}`;
    } else {
      const donorUrls = getDonorUrls(basePath, filter, pageNum, 5);
      url = donorUrls[0] + "_agg5";
    }

    console.log(`[API] Fetching serials for filter "${filter || 'latest'}", page ${page}. URL: ${url}`);
    const cacheId = `list:${url}`;
    
    // SWR Logic: Check cache first
    const { data: cachedList } = await supabase
      .from('content_cache')
      .select('*')
      .eq('id', cacheId)
      .single();

    if (cachedList) {
      let items = [];
      try { items = JSON.parse(cachedList.description); } catch (e) {}
      const isEmpty = Array.isArray(items) && items.length === 0;
      const cacheTime = new Date(cachedList.created_at).getTime();
      const isDeploymentStale = cacheTime < DEPLOY_TIME;
      const isAgeStale = Date.now() - cacheTime > 24 * 60 * 60 * 1000;
      
      if (!isAgeStale && !isDeploymentStale && !isEmpty) {
        console.log("Returning fresh cached serials:", url);
        return res.json({ items });
      }

      // If deployment is stale OR list is empty, we MUST await refresh
      if (isDeploymentStale || isEmpty) {
        console.log(`[Urgent] Deployment stale or empty for serials: ${url}`);
      } else {
        console.log(`[Passive] Age stale, returning old serials and refreshing: ${url}`);
        res.json({ items });
        // Background Refresh
        (async () => {
          try {
            let freshItemsS: any[] = [];
            if (isAggregatedS) {
              const donorUrlsListsS = getDonorUrls(basePath, filter, pageNum, 5);
              const htmlPagesS = await fetchPagesWithBrowser(donorUrlsListsS, isTopListS);
              htmlPagesS.forEach(h => { if (h) freshItemsS = [...freshItemsS, ...parseItems(h, 'serial')]; });
            } else {
              freshItemsS = parseItems(await fetchHtml(url), 'serial');
            }

            const processedItemsS = await processItems(freshItemsS);
            if (processedItemsS.length > 0) {
              await supabase.from('content_cache').upsert({ id: cacheId, type: 'list', description: JSON.stringify(processedItemsS), created_at: new Date().toISOString() });
            }
          } catch (e) {}
        })();
        return;
      }
    }

    let items: any[] = [];

    try {
      if (isAggregatedS) {
        const donorUrls = getDonorUrls(basePath, filter, pageNum, 5);
        const htmlPages = await fetchPagesWithBrowser(donorUrls, isTopListS);
        
        htmlPages.forEach(h => {
          if (h) items = [...items, ...parseItems(h, 'serial')];
        });

      } else {
        const html = await fetchHtml(url);
        items = parseItems(html, 'serial');
      }
    } catch (subError: any) {
      console.error(`[API] Serials fetch error: ${subError.message}`);
      return res.json({ items: [] });
    }

    // Heuristic: Inject Game of Thrones if searching for it and results are empty, OR if it's the first page of a top list
    const isSearchGoT = search && (search.toLowerCase().includes('игра престолов') || search.toLowerCase().includes('game of thrones'));
    const isFirstPageTopList = pageNum === 1 && isTopListS;
    if ((isSearchGoT || isFirstPageTopList) && !items.find((i: any) => i.id === '8')) {
      try {
        const gotHtml = await fetchHtml(`${BASE_URL}/serials/8`);
        if (gotHtml) {
          const $ = cheerio.load(gotHtml);
          const title = $(".acat").first().contents().filter((i, el) => el.type === 'text').first().text().trim();
          const img = $(".filmscreen").attr("src");
          
          items.unshift({
            id: '8',
            title,
            img: img?.startsWith('http') ? img : BASE_URL + img,
            rating: $(".rei").text().trim() || "9.0",
            year: "2011",
            genres: ["Фэнтези", "Драма"],
            desc: "Игра Престолов официально доступна через поиск."
          });
        }
      } catch (e) {
        console.warn("Search heuristic fallback failed:", e);
      }
    }

    const processedItems = await processItems(items);
    const junkRegex = /телефон|phone|anwap|online|скачать|мобильн/i;
    const finalClean = processedItems.filter((i: any) => !junkRegex.test(i.title) && !junkRegex.test(i.title_ru || ""));

    res.json({ items: finalClean });
  } catch (error: any) {
    console.error("Error fetching serials. URL:", url || "unknown");
    console.error("Error details:", error.message);
    res.status(500).json({ error: "Failed to fetch serials" });
  }
});

app.get("/api/details/movie/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const bypassCache = req.query.cache === '0';

    if (!bypassCache) {
      const { data: cachedDetail } = await supabase
        .from('content_cache')
        .select('description, created_at')
        .eq('id', `detail:movie:${id}`)
        .single();
        
      if (cachedDetail && cachedDetail.description) {
        const isStale = Date.now() - new Date(cachedDetail.created_at).getTime() > 7 * 24 * 60 * 60 * 1000; // 7 days
        if (!isStale) {
          console.log(`[Cache Hit] Full detail cache hit for movie ID: ${id}`);
          return res.json(JSON.parse(cachedDetail.description));
        }
      }
    }
    
    const url = `${BASE_URL}/films/${id}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    
    const downloads: any[] = [];
    $(".tl li a, .tl2 li a").each((_, el) => {
      const href = $(el).attr("href");
      const text = cleanDownloadText($(el).text().trim());
      // Skip trailer/preview search links
      if (href && !/(искать|трейлер|превью|trailer|preview)/i.test($(el).text())) {
        downloads.push({ url: BASE_URL + href, text });
      }
    });

    const title = $(".acat").first().contents().filter((i, el) => el.type === 'text').first().text().trim();
    const img = $(".filmscreen").attr("src");
    // Get full plot (take the whole .filmopis.screen3 content but stop at <hr>)
    let desc = "";
    $(".filmopis.screen3").contents().each((_, el) => {
      if (el.type === 'tag' && (el.name === 'hr' || (el.name === 'span' && $(el as any).text().includes('Знаете ли вы')))) {
        return false; // stop
      }
      if (el.type === 'tag' && el.name === 'p') {
        const text = $(el).text().trim();
        if (text) desc += text + " ";
      } else if (el.type === 'text') {
        const text = (el as any).data.trim();
        if (text) desc += text + " ";
      }
    });
    desc = desc.trim();
    
    // Scrape genres from details page if possible
    const genres: string[] = [];
    $(".filminfo a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.includes('/films/genre/')) {
        genres.push($(el).text().trim());
      }
    });

    // Always translate the full description from the detail page
    const sanitizedTitle = sanitizeTitle(title);
    const toTranslate = [sanitizedTitle, desc, ...genres];
    const translated = await batchTranslate(toTranslate);
    
    const translatedTitle = translated[0];
    const translatedDesc = translated[1] || "";
    const translatedGenres = translated.slice(2);
    
    const recommendations: any[] = [];
    $(".popular").each((_, el) => {
      const headerText = $(el).text().trim();
      if (headerText.includes("Другие части") || headerText.includes("Похожие") || headerText.includes("Рекомендуем")) {
        const section = $(el).next(".section");
        section.find(".section_item").each((_, itemEl) => {
          const a = $(itemEl).find("a").first();
          const href = a.attr("href");
          const recId = href?.split("/").pop();
          const recImg = $(itemEl).find("img.screenf").attr("src");
          const recTitle = $(itemEl).find(".namefilm").text().trim();
          const recRating = $(itemEl).find(".rei").text().trim();
          const recYear = $(itemEl).find(".godv").text().trim();
          
          if (recId && recTitle) {
            recommendations.push({ 
              id: recId, 
              title: recTitle, 
              img: recImg?.startsWith('http') ? recImg : (recImg?.startsWith('//') ? 'https:' + recImg : BASE_URL + recImg), 
              rating: recRating, 
              year: recYear,
              type: 'movie'
            });
          }
        });
      }
    });

    // Translate recommendation titles in batch
    if (recommendations.length > 0) {
      const recTitles = recommendations.map(r => r.title);
      const translatedRecTitles = await batchTranslate(recTitles);
      recommendations.forEach((r, i) => {
        r.title_ru = sanitizeTitle(r.title); // Store original Ru title
        r.title = sanitizeTitle(translatedRecTitles[i]);
      });
    }
    
    const result = { 
      id, 
      title: translatedTitle, 
      img: img?.startsWith('http') ? img : BASE_URL + img, 
      desc: translatedDesc,
      genres: translatedGenres,
      title_ru: sanitizedTitle,
      desc_ru: desc,
      genres_ru: genres,
      downloads,
      recommendations
    };
    
    // Save/update cache with the full description from the detail page
    setCachedContent({ ...result, type: 'movie' });
    
    // Save full response for lightning fast loading
    supabase.from('content_cache').upsert({
      id: `detail:movie:${id}`,
      type: 'detail',
      description: JSON.stringify(result),
      created_at: new Date().toISOString()
    }).then();
    
    res.json(result);
  } catch (error: any) {
    console.error("Error fetching movie details:", error.message);
    res.status(500).json({ error: "Failed to fetch movie details" });
  }
});

app.get("/api/details/serial/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const bypassCache = req.query.cache === '0';

    if (!bypassCache) {
      const { data: cachedDetail } = await supabase
        .from('content_cache')
        .select('description, created_at')
        .eq('id', `detail:serial:${id}`)
        .single();
        
      if (cachedDetail && cachedDetail.description) {
        const isStale = Date.now() - new Date(cachedDetail.created_at).getTime() > 7 * 24 * 60 * 60 * 1000; // 7 days
        if (!isStale) {
          console.log(`[Cache Hit] Full detail cache hit for serial ID: ${id}`);
          return res.json(JSON.parse(cachedDetail.description));
        }
      }
    }

    const url = `${BASE_URL}/serials/${id}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    
    const title = $(".acat").first().contents().filter((i, el) => el.type === 'text').first().text().trim();
    const img = $(".filmscreen").attr("src");
    // Get full plot (take the whole .filmopis.screen3 content but stop at <hr>)
    let desc = "";
    $(".filmopis.screen3").contents().each((_, el) => {
      if (el.type === 'tag' && (el.name === 'hr' || (el.name === 'span' && $(el as any).text().includes('Знаете ли вы')))) {
        return false; // stop
      }
      if (el.type === 'tag' && el.name === 'p') {
        const text = $(el).text().trim();
        if (text) desc += text + " ";
      } else if (el.type === 'text') {
        const text = (el as any).data.trim();
        if (text) desc += text + " ";
      }
    });
    desc = desc.trim();
    
    // Scrape genres
    const genres: string[] = [];
    $(".filminfo a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.includes('/serials/genre/')) {
        genres.push($(el).text().trim());
      }
    });

    // Always translate the full description from the detail page
    const sanitizedTitle = sanitizeTitle(title);
    const toTranslate = [sanitizedTitle, desc, ...genres];
    const translated = await batchTranslate(toTranslate);

    const translatedTitle = translated[0];
    const translatedDesc = translated[1];
    const translatedGenres = translated.slice(2);
    
    const recommendations: any[] = [];
    $(".popular").each((_, el) => {
      const headerText = $(el).text().trim();
      if (headerText.includes("Другие части") || headerText.includes("Похожие") || headerText.includes("Рекомендуем")) {
        const section = $(el).next(".section");
        section.find(".section_item").each((_, itemEl) => {
          const a = $(itemEl).find("a").first();
          const href = a.attr("href");
          const recId = href?.split("/").pop();
          const recImg = $(itemEl).find("img.screenf").attr("src");
          const recTitle = $(itemEl).find(".namefilm").text().trim();
          const recRating = $(itemEl).find(".rei").text().trim();
          const recYear = $(itemEl).find(".godv").text().trim();
          
          if (recId && recTitle) {
            recommendations.push({ 
              id: recId, 
              title: recTitle, 
              img: recImg?.startsWith('http') ? recImg : (recImg?.startsWith('//') ? 'https:' + recImg : BASE_URL + recImg), 
              rating: recRating, 
              year: recYear,
              type: 'serial'
            });
          }
        });
      }
    });

    // Translate recommendation titles in batch
    if (recommendations.length > 0) {
      const recTitles = recommendations.map(r => r.title);
      const translatedRecTitles = await batchTranslate(recTitles);
      recommendations.forEach((r, i) => {
        r.title_ru = sanitizeTitle(r.title); // Store original Ru title
        r.title = sanitizeTitle(translatedRecTitles[i]);
      });
    }

    const result = { 
      id, 
      title: translatedTitle, 
      img: img?.startsWith('http') ? img : BASE_URL + img, 
      desc: translatedDesc,
      genres: translatedGenres,
      title_ru: sanitizedTitle,
      desc_ru: desc,
      genres_ru: genres,
      recommendations
    };
    
    // Save/update cache with the full description from the detail page
    setCachedContent({ ...result, type: 'serial' });
    
    // Save full response for lightning fast loading
    supabase.from('content_cache').upsert({
      id: `detail:serial:${id}`,
      type: 'detail',
      description: JSON.stringify(result),
      created_at: new Date().toISOString()
    }).then();

    res.json(result);
  } catch (error: any) {
    console.error("Error fetching serial details:", error.message);
    res.status(500).json({ error: "Failed to fetch serial details" });
  }
});
app.get("/api/details/serial/:id/seasons", async (req, res) => {
  try {
    const { id } = req.params;
    
    const url = `${BASE_URL}/serials/${id}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    
    const seasons: any[] = [];
    
    // Find all valid season links (e.g. /serials/s1234)
    const lang = (req.query.lang as string) || 'ru';
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.match(/^\/serials\/s\d+$/)) {
        const seasonId = href.split('/').pop();
        let title = $(el).text().trim();
        
        // Fix Anwap admin typos where they name a season "Серии(10)" instead of "Весь 4 Сезон(10)"
        if (title.toLowerCase().startsWith('серии(')) {
          title = title.replace(/серии/i, 'Сезон ');
        }
        
        // Translate season title if English
        if (lang.startsWith('en')) {
           const seasonMatch = title.match(/(\d+)\s*(сезон|season)/i);
           if (seasonMatch) {
             title = `Season ${seasonMatch[1]}`;
           } else if (title.toLowerCase().includes('все серии') || title.toLowerCase().includes('все сезоны')) {
             title = "All Episodes";
           }
        }

        // Fallback string if text is empty
        if (!title) title = lang.startsWith('en') ? `Folder ${seasonId}` : `Папка ${seasonId}`;
        
        if (seasonId && !seasons.find(s => s.id === seasonId)) {
          seasons.push({ id: seasonId, title: title });
        }
      }
    });

    res.json({ seasons });
  } catch (error: any) {
    console.error("Error fetching seasons:", error.message);
    res.status(500).json({ error: "Failed to fetch seasons" });
  }
});

app.get("/api/details/serial/season/:seasonId", async (req, res) => {
  try {
    const { seasonId } = req.params;
    const url = `${BASE_URL}/serials/${seasonId}`;
    const mainHtml = await fetchHtml(url);
    
    let episodes: any[] = [];
    
    const parseEpisodes = (htmlStr: string) => {
      const lang = (req.query.lang as string) || 'ru';
      const $ = cheerio.load(htmlStr);
      $('a').each((_, el) => {
        const href = $(el).attr('href');
        if (href && href.match(/^\/serials\/down\/\d+$/)) {
          const episodeId = href.split('/').pop();
          let title = $(el).text().trim();
          
          // Normalize title from "Люцифер (1 сезон) - 13 серия" to "Episode 13"
          let epMatch = title.match(/(\d+)\s*(серия|эпизод|ep|episode)/i);
          let normalizedTitle = epMatch ? (lang.startsWith('en') ? `Episode ${epMatch[1]}` : `${epMatch[1]} серия`) : title;
          if (!normalizedTitle) normalizedTitle = lang.startsWith('en') ? `Episode ${episodeId}` : `${episodeId} серия`;
          
          if (episodeId && !episodes.find(e => e.id === episodeId)) {
            episodes.push({ id: episodeId, title: normalizedTitle, originalNumber: parseInt(epMatch ? epMatch[1] : '0') });
          }
        }
      });
    };

    // Parse the first page
    parseEpisodes(mainHtml);
    
    // Check for pagination links for the season (e.g., if a season has 30 episodes, they are split across pages)
    const $main = cheerio.load(mainHtml);
    const otherPages: string[] = [];
    $main('.pages a').each((_, el) => {
      const href = $main(el).attr('href');
      if (href && href.includes('/serials/') && !otherPages.includes(href)) {
        otherPages.push(href);
      }
    });

    // Fetch other pages concurrently if they exist
    if (otherPages.length > 0) {
      const pagesHtml = await Promise.all(otherPages.map(pageUrl => fetchHtml(`${BASE_URL}${pageUrl}`)));
      pagesHtml.forEach(h => parseEpisodes(h));
    }
    
    // Sort chronologically by extracted episode number
    episodes.sort((a, b) => a.originalNumber - b.originalNumber);
    episodes = episodes.map(e => ({ id: e.id, title: e.title })); // Strip sort field

    res.json({ episodes });
  } catch (error: any) {
    console.error("Error fetching episodes:", error.message);
    res.status(500).json({ error: "Failed to fetch episodes" });
  }
});

app.get("/api/details/serial/episode/:episodeId", async (req, res) => {
  try {
    const { episodeId } = req.params;
    const url = `${BASE_URL}/serials/down/${episodeId}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    
    const downloads: any[] = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      // Find actual download links pointing to /serials/load/ or /file/ or containing size strings
      if (href && (href.includes('/serials/load/') || href.includes('/file/'))) {
        const text = cleanDownloadText($(el).text().trim());
        if (text && !/(искать|трейлер|превью|trailer|preview|отрезок|комментарии)/i.test(text)) {
          if (!downloads.find(d => d.url === BASE_URL + href)) {
            downloads.push({ url: BASE_URL + href, text });
          }
        }
      }
    });

    res.json({ downloads });
  } catch (error: any) {
    console.error("Error fetching episode downloads:", error.message);
    res.status(500).json({ error: "Failed to fetch episode downloads" });
  }
});

app.get("/api/download", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("URL is required");

    const targetUrl = (url as string).startsWith('http') ? (url as string) : `${BASE_URL}${url}`;

    // Standard Direct Redirect logic
    // We send a 302 Found redirect so the client's browser natively downloads from the donor site,
    // avoiding expensive Vercel execution and bandwidth costs.
    res.redirect(302, targetUrl);
  } catch (error: any) {
    console.error("Download redirect error:", error.message);
    res.status(500).send("Failed to process download request");
  }
});

app.post("/api/log", async (req, res) => {
  try {
    const { userId, eventType, itemId, itemTitle, platform } = req.body;
    const { error } = await supabase.from('activity_logs').insert({
      user_id: userId || 'anonymous',
      event_type: eventType,
      item_id: itemId,
      item_title: itemTitle,
      platform: platform || 'unknown'
    });
    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Logging error:", error.message);
    res.status(500).json({ error: "Failed to log event" });
  }
});

export default app;
