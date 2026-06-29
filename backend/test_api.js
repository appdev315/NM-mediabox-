import crypto from 'crypto';
import axios from 'axios';

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
    
    // 5. Test with unauthorized valid TG user
    try {
        const auth = generateAuth({ id: 2, username: 'random_guy' });
        const res = await axios.get('https://evro90-nm6.hf.space/api/vip/downloads/latest', {
            headers: { 'Authorization': `tma ${auth}` }
        });
        console.log(`❌ Test 5 Failed: Non-VIP user bypassed check!`);
    } catch (e) {
        console.log(`✅ Test 5 Passed: Non-VIP user blocked (${e.response?.status})`);
    }
}

runTests();
