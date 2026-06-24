const axios = require('axios');
const cheerio = require('cheerio');

async function run() {
    const res = await axios.get("https://mj.anwap.today/films/search/?slv=RED&vid=1", { headers: {'User-Agent':'Mozilla/5.0'} });
    const $ = cheerio.load(res.data);
    console.log("Pagination links:");
    $('a').each((i, el) => {
        const text = $(el).text();
        const href = $(el).attr('href');
        if (href && href.includes('search')) {
            console.log(text, href);
        }
    });
}
run();
