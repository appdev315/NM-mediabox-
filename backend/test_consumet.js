import { MOVIES } from '@consumet/extensions';

(async () => {
  const flixhq = new MOVIES.FlixHQ();
  console.log("Searching House of the Dragon...");
  try {
      const searchRes = await flixhq.search("House of the Dragon");
      if (searchRes.results.length > 0) {
        const id = searchRes.results[0].id;
        console.log("Found ID:", id);
        
        const info = await flixhq.fetchMediaInfo(id);
        console.log("Got episodes:", info.episodes.length);
        
        if (info.episodes.length > 0) {
            const stream = await flixhq.fetchEpisodeSources(info.episodes[0].id, id);
            console.log("Stream links:", stream.sources);
        }
      } else {
        console.log("No results");
      }
  } catch(e) {
      console.log("Error:", e.message);
  }
})();
