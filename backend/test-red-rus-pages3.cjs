const axios = require('axios');
const cheerio = require('cheerio');

async function search(query, targetYear) {
    for (let page = 1; page <= 5; page++) {
        let url = `https://mj.anwap.today/films/search/?slv=${encodeURIComponent(query)}&vid=1&page=${page}`;
        const res = await axios.get(url, { headers: {'User-Agent':'Mozilla/5.0'} });
        const $ = cheerio.load(res.data);
        
        $('.my_razdel a[href*="/films/"], .my_razdel a[href*="/serials/"], .item a').each((i, el) => {
            const container = $(el).closest('.my_razdel, .item');
            const fullText = container.text().toLowerCase().replace(/\s+/g, ' ');
            if (fullText.includes(targetYear) && fullText.includes('уиллис')) {
                console.log(`FOUND BRUCE WILLIS! ${fullText} => ${$(el).attr('href')}`);
            }
            if (fullText.includes(targetYear)) {
                console.log(`MATCH 2010: ${fullText}`);
            }
        });
    }
}
search('РЭД', '2010');
