const axios = require('axios');
async function run() {
    try {
        const checkRes = await axios.get('https://api.ortified.ws/embed/imdb/tt11198330', { validateStatus: () => true });
        console.log("Status:", checkRes.status);
        console.log("Body snippet:", checkRes.data.substring(0, 200));
    } catch(e) {
        console.log("Error:", e.message);
    }
}
run();
