import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://mobile.kinozuma.net';

export async function getLatestDownloads() {
  try {
    const res = await axios.get(`${BASE_URL}/top100.html`);
    const $ = cheerio.load(res.data);
    const items = [];

    $('.top').each((i, el) => {
      const url = $(el).attr('href');
      const title = $(el).find('.top__title').text().trim();
      let poster = $(el).find('img').attr('src');
      if (poster && !poster.startsWith('http')) poster = BASE_URL + poster;
      
      const yearMatch = url.match(/-(\d{4})-/);
      const year = yearMatch ? yearMatch[1] : '';

      items.push({
        id: url ? Buffer.from(url).toString('base64') : '',
        title,
        poster,
        info: year,
        source: 'kinozuma'
      });
    });

    return items;
  } catch (error) {
    console.error('Kinozuma fetch error:', error.message);
    return [];
  }
}

export async function searchDownloads(query) {
  try {
    const formData = new URLSearchParams();
    formData.append('do', 'search');
    formData.append('subaction', 'search');
    formData.append('story', query);

    const res = await axios.post(`${BASE_URL}/index.php?do=search`, formData);
    const $ = cheerio.load(res.data);
    const items = [];

    // Search results use a different HTML structure
    $('.card-head').each((i, el) => {
      const a = $(el).find('a.card-title');
      const url = a.attr('href');
      const title = a.text().trim();
      
      const parentContainer = $(el).closest('.sect__content, .item, article, li').length ? 
                              $(el).closest('.sect__content, .item, article, li') : 
                              $(el).parent();
                              
      let poster = parentContainer.find('img').attr('src');
      if (poster && !poster.startsWith('http')) poster = BASE_URL + poster;

      const yearMatch = url && url.match(/-(\d{4})-/);
      const year = yearMatch ? yearMatch[1] : '';

      if (url) {
        items.push({
          id: Buffer.from(url).toString('base64'),
          title,
          poster,
          info: year,
          source: 'kinozuma'
        });
      }
    });

    return items;
  } catch (error) {
    console.error('Kinozuma search error:', error.message);
    return [];
  }
}

export async function getDownloadLinks(url) {
  try {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    const links = [];

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && (href.includes('.mp4') || href.includes('vsimk') || href.includes('download') || href.includes('dl'))) {
        let quality = $(el).text().trim() || 'Download';
        // Cleanup text "Скачать 476MB"
        quality = quality.replace(/скачать/i, '').trim();
        
        links.push({
          url: href,
          quality: 'MP4',
          size: quality
        });
      }
    });

    return links;
  } catch (error) {
    console.error('Kinozuma links error:', error.message);
    return [];
  }
}
