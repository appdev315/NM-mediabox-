const axios = require('axios');
async function test(id) {
  try {
    const res = await axios.get(`https://api.ortified.ws/embed/imdb/${id}`);
    console.log(id, 'SUCCESS', res.status);
  } catch (e) {
    console.log(id, 'ERROR', e.response?.status || e.message);
  }
}
test('tt0944947');
test('tt1216222');
