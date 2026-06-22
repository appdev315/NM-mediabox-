const https = require('https');

https.get('https://mj.anwap.today/serials/load/mp4/8aa53/53495', (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
});
