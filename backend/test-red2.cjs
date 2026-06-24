const axios = require('axios');
const cheerio = require('cheerio');
async function run() {
    const res = await axios.get("https://mj.anwap.today/films/search/?slv=RED&vid=1&p=2", { headers: {'User-Agent':'Mozilla/5.0'} });
    const $ = cheerio.load(res.data);
    $('.my_razdel').each((i, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        console.log(text);
    });
}
run();
