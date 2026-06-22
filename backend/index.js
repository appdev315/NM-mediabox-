import express from 'express';
import { chromium } from 'playwright-chromium';
import cors from 'cors';

const app = express();
app.use(cors());

const BASE_URL = 'https://mj.anwap.today';

app.get('/api/stream', async (req, res) => {
  const { title, year, type } = req.query;
  if (!title) return res.status(400).json({ error: "Title is required" });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
    const page = await context.newPage();

    let videoUrl = "";
    // Перехватываем ссылки на видеопоток в фоновом режиме трафика
    page.on('request', request => {
      const reqUrl = request.url();
      if ((reqUrl.includes('.m3u8') || reqUrl.includes('.mp4')) && !reqUrl.includes('ads')) {
        if (!videoUrl) videoUrl = reqUrl;
      }
    });

    // 1. Поиск на лету
    const searchPath = type === 'tv' ? '/serials/search/?word=' : '/films/search/?slv=';
    await page.goto(`${BASE_URL}${searchPath}${encodeURIComponent(title)}&vid=1`, { waitUntil: 'domcontentloaded' });

    // 2. Клик по первому совпадению
    const linkSelector = type === 'tv' ? 'a[href*="/serials/"]' : 'a[href*="/films/"]';
    await page.waitForSelector(linkSelector, { timeout: 5000 });
    
    // Переходим на страницу найденного контента
    const firstLink = await page.$eval(linkSelector, el => el.getAttribute('href'));
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
    await page.waitForTimeout(4000);

    await browser.close();

    if (videoUrl) {
      res.json({ url: videoUrl });
    } else {
      res.status(404).json({ error: "Stream not found" });
    }
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Parser running on port ${PORT}`));
