const axios = require('axios');
async function run() {
    const res = await axios.get("https://kinobox.tv/api/players?imdb=tt1245526");
    console.log(JSON.stringify(res.data, null, 2));
}
run();
