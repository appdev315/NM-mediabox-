const axios = require('axios');
const cheerio = require('cheerio');
async function run() {
    const res = await axios.get("https://mj.anwap.today/films/search/?slv=RED&vid=1", { headers: {'User-Agent':'Mozilla/5.0'} });
    const $ = cheerio.load(res.data);
    $('.my_razdel').each((i, el) => {
        const title = $(el).find('.namefilm').text().trim() || $(el).find('a').first().text().trim();
        const year = $(el).find('.god').text().trim(); // Or some other class for year
        const link = $(el).find('a[href*="/films/"]').attr('href');
        console.log(`Title: ${title}, Year: ${year}, Link: ${link}`);
        console.log(`Raw text: ${$(el).text().replace(/\s+/g, ' ').trim()}`);
    });
}
run();
