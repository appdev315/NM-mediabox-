import { getLatestDownloads as kinozumaLatest } from './backend/kinozumaScraper.js';
import { getLatestDownloads as kinovasekLatest } from './backend/downloadScraper.js';

async function main() {
    console.log("Kinozuma latest:");
    console.log(await kinozumaLatest());
    
    console.log("Kinovasek latest:");
    console.log(await kinovasekLatest(1));
}

main();
