const fs = require('fs');
let code = fs.readFileSync('backend/index.js', 'utf8');

const proxyEndpoint = `
app.get('/api/vip/downloads/proxy', async (req, res) => {
    try {
        const urlStr = req.query.url;
        if (!urlStr) return res.status(400).send('URL required');
        const decodedUrl = Buffer.from(urlStr, 'base64').toString('utf8');
        
        let referer = 'https://kinozuma.net';
        if (decodedUrl.includes('vasqa.org') || decodedUrl.includes('serversimka.net') || decodedUrl.includes('kinovasek.net')) {
            referer = 'https://kinovasek.net';
        }

        const response = await axios({
            url: decodedUrl,
            method: 'GET',
            responseType: 'stream',
            headers: {
                'Referer': referer,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });
        
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Content-Disposition', 'attachment; filename="movie.mp4"');
        res.setHeader('Access-Control-Allow-Origin', '*');

        response.data.pipe(res);
    } catch (e) {
        console.error('Proxy error:', e.message);
        res.status(500).send('Proxy error');
    }
});
`;

code = code.replace("app.listen(port, () => {", proxyEndpoint + "\napp.listen(port, () => {");
fs.writeFileSync('backend/index.js', code);
console.log('Patched');
