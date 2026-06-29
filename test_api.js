const crypto = require('crypto');
const axios = require('axios');

const BOT_TOKEN = '8809251472:AAFuX3dgix5QbO7q6olVj6W6dUYeEgfqlz4';

function generateAuth(user) {
    const data = {
        query_id: 'test',
        user: JSON.stringify(user),
        auth_date: Math.floor(Date.now() / 1000).toString(),
    };
    
    const keys = Object.keys(data).sort();
    const dataCheckString = keys.map(k => `${k}=${data[k]}`).join('\n');
    
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
    data.hash = hash;
    return new URLSearchParams(data).toString();
}

async function runTests() {
    console.log("--- Running Security Verification Tests ---");
    
    // 1. Test Without Auth
    try {
        await axios.get('https://evro90-nm6.hf.space/api/vip/downloads/latest');
        console.log("❌ Test 1 Failed: Unauthorized request succeeded!");
    } catch (e) {
        console.log(`✅ Test 1 Passed: Unauthorized access blocked (${e.response?.status})`);
    }

    // 2. Test Proxy Without Auth
    try {
        const maliciousUrl = Buffer.from("http://localhost:6379").toString('base64');
        await axios.get(`https://evro90-nm6.hf.space/api/vip/downloads/proxy?url=${maliciousUrl}`);
        console.log("❌ Test 2 Failed: Proxy accessed without auth!");
    } catch (e) {
        console.log(`✅ Test 2 Passed: Unauthorized Proxy access blocked (${e.response?.status})`);
    }

    // 3. Test Proxy WITH Auth but Malicious URL
    try {
        const maliciousUrl = Buffer.from("http://localhost:6379").toString('base64');
        const auth = generateAuth({ id: 1, username: 'appdev315' }); // valid VIP user
        await axios.get(`https://evro90-nm6.hf.space/api/vip/downloads/proxy?url=${maliciousUrl}`, {
            headers: { 'Authorization': `tma ${auth}` }
        });
        console.log("❌ Test 3 Failed: SSRF URL bypass succeeded!");
    } catch (e) {
        console.log(`✅ Test 3 Passed: SSRF URL bypass blocked (${e.response?.status})`);
    }
    
    // 4. Test Valid Auth and Valid Route
    try {
        const auth = generateAuth({ id: 1, username: 'appdev315' });
        const res = await axios.get('https://evro90-nm6.hf.space/api/vip/status', {
            headers: { 'Authorization': `tma ${auth}` }
        });
        console.log(`✅ Test 4 Passed: Valid VIP auth succeeded (isVip: ${res.data.isVip})`);
    } catch (e) {
        console.log(`❌ Test 4 Failed: Valid auth failed (${e.response?.status})`);
    }
}

runTests();
