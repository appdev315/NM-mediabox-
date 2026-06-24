const axios = require('axios');
const cheerio = require('cheerio');

async function search(query, targetYear) {
    for (let page = 1; page <= 5; page++) {
        let url = `https://mj.anwap.today/films/search/?slv=${encodeURIComponent(query)}&vid=1&page=${page}`;
        const res = await axios.get(url, { headers: {'User-Agent':'Mozilla/5.0'} });
        const $ = cheerio.load(res.data);
        
        let found = false;
        $('.my_razdel a[href*="/films/"], .my_razdel a[href*="/serials/"], .item a').each((i, el) => {
            const container = $(el).closest('.my_razdel, .item');
            const text = container.text().replace(/\s+/g, ' ');
            if (text.includes(targetYear)) {
                console.log(`MATCH FOUND: ${text} => ${$(el).attr('href')}`);
                found = true;
            }
        });
        if (found) return;
        if (!$('a').filter((i, el) => $(el).attr('href') && $(el).attr('href').includes(`page=${page+1}`)).length) break;
    }
}
search('РЭД', '2010');
