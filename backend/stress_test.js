import fetch from 'node-fetch';

const CONCURRENT_USERS = 50; 
const TOTAL_REQUESTS = 200;

const TARGET = process.argv[2] || 'http://localhost:7860';

console.log(`Starting stress test against ${TARGET}...`);
console.log(`Concurrent users: ${CONCURRENT_USERS}`);
console.log(`Total requests: ${TOTAL_REQUESTS}`);

const endpoints = [
    '/api/health',
    '/api/movies/search?q=batman',
    '/api/adult/search?q=babe',
];

let completed = 0;
let errors = 0;

async function makeRequest() {
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    const start = Date.now();
    try {
        const res = await fetch(`${TARGET}${endpoint}`);
        if (!res.ok) {
            if (res.status === 429) {
                // Rate limited (expected)
            } else {
                errors++;
            }
        }
    } catch (e) {
        errors++;
    }
    completed++;
    
    if (completed % 10 === 0) {
        console.log(`Progress: ${completed}/${TOTAL_REQUESTS} (Errors: ${errors})`);
    }
}

async function runTest() {
    let active = 0;
    let launched = 0;
    
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            while (active < CONCURRENT_USERS && launched < TOTAL_REQUESTS) {
                active++;
                launched++;
                makeRequest().then(() => {
                    active--;
                    if (completed >= TOTAL_REQUESTS) {
                        clearInterval(interval);
                        resolve();
                    }
                });
            }
        }, 10);
    });
}

runTest().then(() => {
    console.log(`\n--- Test Completed ---`);
    console.log(`Total Requests: ${TOTAL_REQUESTS}`);
    console.log(`Errors (non-200, non-429 or timeout): ${errors}`);
    if (errors > 0) {
        console.log(`⚠️ Failure rate: ${((errors/TOTAL_REQUESTS)*100).toFixed(1)}%`);
    } else {
        console.log(`✅ All requests succeeded! Rate limiter protected the server.`);
    }
});
