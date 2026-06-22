import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

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

  console.log("Extracting links...");
  const links = await page.$$eval('a', anchors => anchors.map(a => a.href));
  console.log("All links found:");
  console.log(links);

  const iframes = await page.$$eval('iframe', frames => frames.map(f => f.src));
  console.log("Iframes:", iframes);

  await browser.close();
})();
