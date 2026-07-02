import { searchDownloads as kinozumaSearch } from './backend/kinozumaScraper.js';
import { searchDownloads as kinovasekSearch } from './backend/downloadScraper.js';

async function main() {
    console.log("Kinozuma search:");
    console.log(await kinozumaSearch("аватар"));
    
    console.log("Kinovasek search:");
    console.log(await kinovasekSearch("аватар"));
}

main();
