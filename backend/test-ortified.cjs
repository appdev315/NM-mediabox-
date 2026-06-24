const axios = require('axios');
async function run() {
    const checkRes = await axios.get('https://api.ortified.ws/embed/imdb/tt0128076', { validateStatus: () => true });
    console.log(checkRes.status);
    const hasError = checkRes.data.includes('error-description') || checkRes.data.includes('У Вас нет разрешения') || checkRes.data.includes('недоступно');
    console.log("Has error?", hasError);
}
run();
