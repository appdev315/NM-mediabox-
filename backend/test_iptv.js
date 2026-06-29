import axios from 'axios';

async function testChannels() {
  try {
    console.log('Fetching channels...');
    const { data: channels } = await axios.get('https://iptv-org.github.io/api/channels.json');
    const { data: streams } = await axios.get('https://iptv-org.github.io/api/streams.json');
    
    const countries = ['IN', 'ID', 'KR', 'IR'];
    
    for (const country of countries) {
      console.log(`\n--- Testing ${country} ---`);
      const countryChannels = channels.filter(c => c.country === country).slice(0, 5);
      if (countryChannels.length === 0) {
        console.log(`No channels found for ${country}`);
        continue;
      }
      
      for (const channel of countryChannels) {
        const stream = streams.find(s => s.channel === channel.id);
        if (stream && stream.url) {
          try {
            const res = await axios.head(stream.url, { timeout: 3000 });
            console.log(`✅ ${channel.name} (${stream.url}) - HTTP ${res.status}`);
          } catch (e) {
            console.log(`❌ ${channel.name} (${stream.url}) - ${e.message}`);
          }
        } else {
          console.log(`⚠️ ${channel.name} - No stream URL`);
        }
      }
    }
  } catch (e) {
    console.error(e);
  }
}
testChannels();
