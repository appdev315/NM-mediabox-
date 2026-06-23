import { chromium } from 'playwright-extra';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating...");
  await page.goto('https://mj.anwap.today/serials/2244', { waitUntil: 'domcontentloaded' });

  console.log("Going to season...");
  const seasonLink = await page.$eval('a[href*="/serials/s"]', el => el.getAttribute('href'));
  await page.goto(`https://mj.anwap.today${seasonLink}`, { waitUntil: 'domcontentloaded' });

  console.log("Going to episode download page...");
  const episodeLink = await page.$eval('a[href*="/serials/down/"]', el => el.getAttribute('href'));
  await page.goto(`https://mj.anwap.today${episodeLink}`, { waitUntil: 'domcontentloaded' });

  const iframes = await page.$$eval('iframe', frames => frames.map(f => f.src));
  console.log("Iframes:", iframes);

  await browser.close();
})();
