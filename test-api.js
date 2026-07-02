import fetch from 'node-fetch';

async function test() {
    try {
        const res = await fetch('http://localhost:7860/api/vip/downloads/latest');
        const text = await res.text();
        console.log("Status:", res.status);
        console.log("Body:", text);
    } catch(e) {
        console.error(e);
    }
}
test();
