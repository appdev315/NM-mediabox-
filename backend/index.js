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

app.get('/api/stream', async (req, res) => {
  const { title, year, type } = req.query;
  console.log(`[STREAM REQ] title=${title}, year=${year}, type=${type}`);
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
    const searchPath = type === 'tv' ? '/serials/search/?word=' : '/films/search/?slv=';
    const searchUrl = `${BASE_URL}${searchPath}${encodeURIComponent(title)}&vid=1`;
    console.log(`[PLAYWRIGHT] Going to search URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    // 2. Клик по первому совпадению
    const linkSelector = type === 'tv' ? 'a[href*="/serials/"]' : 'a[href*="/films/"]';
    console.log(`[PLAYWRIGHT] Waiting for selector: ${linkSelector}`);
    await page.waitForSelector(linkSelector, { timeout: 8000 });
    
    // Переходим на страницу найденного контента
    const firstLink = await page.$eval(linkSelector, el => el.getAttribute('href'));
    console.log(`[PLAYWRIGHT] Found first link: ${firstLink}`);
    await page.goto(`${BASE_URL}${firstLink}`, { waitUntil: 'domcontentloaded' });

    // 3. Если это сериал — переходим вглубь на первую серию (для теста)
    if (type === 'tv') {
      await page.waitForSelector('a[href*="/serials/s"]', { timeout: 5000 });
      const seasonLink = await page.$eval('a[href*="/serials/s"]', el => el.getAttribute('href'));
      await page.goto(`${BASE_URL}${seasonLink}`, { waitUntil: 'domcontentloaded' });

      await page.waitForSelector('a[href*="/serials/down/"]', { timeout: 5000 });
      const episodeLink = await page.$eval('a[href*="/serials/down/"]', el => el.getAttribute('href'));
      await page.goto(`${BASE_URL}${episodeLink}`, { waitUntil: 'domcontentloaded' });
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

    await browser.close();

    if (videoUrl) {
      console.log(`[PLAYWRIGHT] SUCCESS! Stream URL found: ${videoUrl}`);
      res.json({ url: videoUrl });
    } else {
      const iframes = await page.$$eval('iframe', frames => frames.map(f => f.src));
      if (iframes.length > 0) {
        console.log(`[PLAYWRIGHT] SUCCESS! Iframe URL found: ${iframes[0]}`);
        res.json({ iframe: iframes[0] });
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
