const axios = require('axios');
async function run() {
    const res = await axios.get("https://mj.anwap.today/films/search/?slv=tt1245526&vid=1", { headers: {'User-Agent':'Mozilla/5.0'} });
    console.log(res.data.includes('РЭД') ? 'Found РЭД' : 'Not found');
}
run();
