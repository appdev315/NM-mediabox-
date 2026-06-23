import express from 'express';
import { chromium } from 'playwright-extra';
import cors from 'cors';

const app = express();

app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept']
}));

const BASE_URL = 'https://mj.anwap.today';

app.get('/', (req, res) => res.json({ status: 'OK', message: 'Parser is running' }));

app.get('/api/kinobox', async (req, res) => {
    try {
        const { tmdb } = req.query;
        if (!tmdb) return res.status(400).json({ error: "tmdb param is required" });
        
        // Use dynamically imported node-fetch or native fetch
        const fetchFn = global.fetch || (await import('node-fetch')).default;
        const response = await fetchFn(`https://kinobox.tv/api/players?tmdb=${tmdb}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });
        
        if (!response.ok) {
            return res.status(response.status).json({ error: "Kinobox API error" });
        }
        
        const data = await response.json();
        res.json(data);
    } catch(e) {
        console.error("Kinobox Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stream', async (req, res) => {
    const { title, year, type, season, episode } = req.query;
    console.log(`[STREAM REQ] title=${title}, year=${year}, type=${type}, season=${season}, episode=${episode}`);
    if (!title) return res.status(400).json({ error: "Title is required" });

    let browser;
    try {
      console.log(`[PLAYWRIGHT] Launching browser...`);
      browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
      const page = await context.newPage();

      let videoUrl = "";
      // Перехватываем ссылки на видеопоток в фоновом режиме трафика
      page.on('request', request => {
        const reqUrl = request.url();
        if (reqUrl.includes('.m3u8') || reqUrl.includes('.mp4')) {
          console.log(`[NETWORK] Found media URL: ${reqUrl}`);
          if (!videoUrl && !reqUrl.includes('ads') && !reqUrl.includes('trailer')) videoUrl = reqUrl;
        }
      });

      // 1. Поиск на лету
      if (type === 'tv') {
        console.log(`[PLAYWRIGHT] Simulating search for serials: ${title}`);
        await page.goto(`${BASE_URL}/serials/search`, { waitUntil: 'domcontentloaded' });
        await page.fill('input[name="word"]', title);
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.click('input[type="submit"]')
        ]);
      } else {
        const searchPath = '/films/search/?slv=';
        const searchUrl = `${BASE_URL}${searchPath}${encodeURIComponent(title)}&vid=1`;
        console.log(`[PLAYWRIGHT] Going to search URL: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      }

      // 2. Клик по совпадению
      const linkSelector = type === 'tv' ? '.film a[href*="/serials/"]' : '.film a[href*="/films/"]';
      console.log(`[PLAYWRIGHT] Waiting for selector: ${linkSelector}`);
      await page.waitForSelector(linkSelector, { timeout: 8000 });
      
      const links = await page.$$eval(linkSelector, els => els.map(e => ({
          href: e.getAttribute('href'),
          text: e.textContent.replace(/\s+/g, ' ').trim()
      })));

      // Ищем точное вхождение названия
      let bestLink = null;
      const cleanTitle = title.toLowerCase().trim();
      
      // Функция очистки названия от приписок Anwap (например " (1-4 сезоны)", " (5 сезон)")
      const cleanAnwapName = (str) => {
         return str.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
      };

      for (const link of links) {
         const baseName = cleanAnwapName(link.text);
         // Ищем точное совпадение очищенного имени
         if (baseName === cleanTitle) {
             bestLink = link.href;
             break;
         }
      }
      
      // Если точного совпадения нет, не берем случайное аниме
      if (!bestLink) throw new Error("Точное совпадение не найдено в поиске Anwap. Возможно, сериал скрыт (shadowban) на данном зеркале.");

      console.log(`[PLAYWRIGHT] Found best link: ${bestLink}`);
      await page.goto(`${BASE_URL}${bestLink}`, { waitUntil: 'domcontentloaded' });

      // 3. Если это сериал — переходим вглубь на нужный сезон и серию
      if (type === 'tv') {
        await page.waitForSelector('a[href*="/serials/s"]', { timeout: 5000 });
        const seasonLinks = await page.$$eval('a[href*="/serials/s"]', els => els.map(e => ({ text: e.textContent.trim(), href: e.getAttribute('href') })));
        
        let seasonHref = seasonLinks[0]?.href;
        if (season) {
          const targetSeason = seasonLinks.find(link => new RegExp('\\b' + season + '\\s*сезон', 'i').test(link.text));
          if (targetSeason) seasonHref = targetSeason.href;
        }

        if (seasonHref) {
          await page.goto(`${BASE_URL}${seasonHref}`, { waitUntil: 'domcontentloaded' });
          
          await page.waitForSelector('a[href*="/serials/down/"]', { timeout: 5000 });
          const episodeLinks = await page.$$eval('a[href*="/serials/down/"]', els => els.map(e => ({ text: e.textContent.trim(), href: e.getAttribute('href') })));
          
          let episodeHref = episodeLinks[0]?.href;
          if (episode) {
            const targetEpisode = episodeLinks.find(link => new RegExp('\\-\\s*' + episode + '\\s*серия', 'i').test(link.text));
            if (targetEpisode) episodeHref = targetEpisode.href;
          }

          if (episodeHref) {
            await page.goto(`${BASE_URL}${episodeHref}`, { waitUntil: 'domcontentloaded' });
          }
        }
      }

    // Ожидаем триггера загрузки плеера для перехвата потока
    console.log(`[PLAYWRIGHT] Reached final page. Extracting iframes and videos...`);
    
    try {
      const iframes = await page.$$eval('iframe', frames => frames.map(f => f.src));
      console.log(`[PLAYWRIGHT] Iframes on page:`, iframes);
      const videos = await page.$$eval('video', vids => vids.map(v => v.src));
      console.log(`[PLAYWRIGHT] Video tags on page:`, videos);
      const videoSources = await page.$$eval('source', sources => sources.map(s => s.src));
      console.log(`[PLAYWRIGHT] Video sources on page:`, videoSources);
      
      // Try to click play if there's a play button
      // const playButton = await page.$('.play-btn, .vjs-play-control');
      // if (playButton) await playButton.click();
      
      // Click center of the page just in case it triggers the player
      await page.mouse.click(100, 100);
      await page.mouse.click(200, 200);
    } catch (e) {
      console.log(`[PLAYWRIGHT] Error extracting media elements: ${e.message}`);
    }

    console.log(`[PLAYWRIGHT] Waiting 4000ms for video stream to be intercepted...`);
    await page.waitForTimeout(4000);

    let iframes = [];
    if (!videoUrl) {
      iframes = await page.$$eval('iframe', frames => frames.map(f => f.src));
    }

    await browser.close();

    if (videoUrl) {
      console.log(`[PLAYWRIGHT] SUCCESS! Stream URL found: ${videoUrl}`);
      res.json({ url: videoUrl });
    } else {
      if (iframes.length > 0) {
        let finalIframe = iframes[0];
        
        // Синхронизируем выбор сезона и серии с параметрами плеера
        if (type === 'tv' && (season || episode)) {
          try {
            const urlObj = new URL(finalIframe);
            if (season) urlObj.searchParams.set('season', season);
            if (episode) urlObj.searchParams.set('episode', episode);
            finalIframe = urlObj.toString();
          } catch (e) {
            console.error("Failed to parse iframe URL:", e);
          }
        }

        console.log(`[PLAYWRIGHT] SUCCESS! Iframe URL found: ${finalIframe}`);
        res.json({ iframe: finalIframe });
      } else {
        console.log(`[PLAYWRIGHT] FAILED: Stream URL not found after 4s wait.`);
        res.status(404).json({ error: "Stream not found" });
      }
    }
  } catch (err) {
    console.error(`[PLAYWRIGHT ERROR]`, err);
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Parser running on port ${PORT}`));
