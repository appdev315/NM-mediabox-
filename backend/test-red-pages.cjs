const axios = require('axios');
const cheerio = require('cheerio');

async function search(query, targetYear) {
    let url = `https://mj.anwap.today/films/search/?slv=${encodeURIComponent(query)}&vid=1`;
    for (let page = 1; page <= 5; page++) {
        console.log(`Fetching page ${page}: ${url}`);
        const res = await axios.get(url, { headers: {'User-Agent':'Mozilla/5.0'}, validateStatus: () => true });
        if (res.status !== 200) break;
        const $ = cheerio.load(res.data);
        
        let found = false;
        $('.my_razdel a[href*="/films/"], .my_razdel a[href*="/serials/"], .item a').each((i, el) => {
            const container = $(el).closest('.my_razdel, .item');
            const text = container.text().replace(/\s+/g, ' ');
            if (text.includes(targetYear) && text.toLowerCase().includes(query.toLowerCase())) {
                console.log(`MATCH FOUND: ${text} => ${$(el).attr('href')}`);
                found = true;
            }
        });
        if (found) return;
        
        // Find next page link
        const nextLink = $('.navig a').filter((i, el) => $(el).text().includes('Вперед') || $(el).text().includes('>>')).attr('href');
        if (!nextLink) break;
        url = `https://mj.anwap.today${nextLink}`;
    }
}
search('RED', '2010');
