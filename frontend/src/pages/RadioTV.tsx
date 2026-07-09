import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useLanguage } from '../context/LanguageContext';
import { Header } from '../components/Header';
import { WebApp } from '../telegram';
import ExoClickWhiteAd from '../components/ExoClickWhiteAd';
import { ExoClickMainBanner } from '../components/ExoClickMainBanner';
import { useNavigate } from 'react-router-dom';
import { shouldShowAd } from '../utils/adPlacement';

// Get backend URL from environment or use default


interface Station {
  id: string;
  name: string;
  url: string;
  logo: string;
  group?: string;
  type?: 'radio' | 'tv';
  isHttp?: boolean;
  originalUrl?: string; // Original URL for fallback if proxied URL fails
}

const COUNTRIES = [
  { code: 'au', name: 'Australia', radioName: 'Australia' },
  { code: 'by', name: 'Belarus', radioName: 'Belarus' },
  { code: 'br', name: 'Brazil', radioName: 'Brazil' },
  { code: 'fr', name: 'France', radioName: 'France' },
  { code: 'de', name: 'Germany', radioName: 'Germany' },
  { code: 'in', name: 'India', radioName: 'India' },
  { code: 'id', name: 'Indonesia', radioName: 'Indonesia' },
  { code: 'ir', name: 'Iran', radioName: 'Iran' },
  { code: 'kz', name: 'Kazakhstan', radioName: 'Kazakhstan' },
  { code: 'mx', name: 'Mexico', radioName: 'Mexico' },
  { code: 'ru', name: 'Russia', radioName: 'Russia' },
  { code: 'kr', name: 'South Korea', radioName: 'South Korea' },
  { code: 'gb', name: 'UK', radioName: 'United Kingdom' },
  { code: 'us', name: 'USA', radioName: 'United States' },
];

const FREE_TV_MAP: Record<string, string> = {
  'ru': 'russia',
  'us': 'usa',
  'gb': 'uk',
  'de': 'germany',
  'fr': 'france',
  'by': 'belarus',
  'kz': 'kazakhstan',
  'in': 'india',
  'id': 'indonesia',
  'kr': 'south_korea',
  'ir': 'iran',
  'br': 'brazil',
  'mx': 'mexico',
  'au': 'australia'
};

export function RadioTV() {
  const navigate = useNavigate();



  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [showTvWarning] = useState(false);
  const [activeTab] = useState<'radio' | 'tv'>('radio');
  const [country, setCountry] = useState(() => {
    const saved = localStorage.getItem('radio_tv_country');
    if (saved) return saved;
    const tgLang = WebApp.initDataUnsafe?.user?.language_code;
    if (tgLang === 'ko') return 'kr';
    if (tgLang === 'id') return 'id';
    if (tgLang === 'hi') return 'in';
    if (tgLang === 'fa') return 'ir';
    return 'ru';
  });
  const [tvSource, setTvSource] = useState(localStorage.getItem('tv_source') || '1');
  const [stations, setStations] = useState<Station[]>([]);
  const [tvChannels, setTvChannels] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);

  const [activeTvChannel, setActiveTvChannel] = useState<Station | null>(null);
  const [tvError, setTvError] = useState(false);
  const [tvLoading, setTvLoading] = useState(false);

  // Favorites State
  const [favorites, setFavorites] = useState<Station[]>([]);

  const { playTrack, currentTrack, stop } = useAudioPlayer();
  const { t } = useLanguage();

  useEffect(() => {
    const savedFavs = localStorage.getItem('radio_tv_favs');
    if (savedFavs) {
      try { setFavorites(JSON.parse(savedFavs)); } catch (e) { }
    }
  }, []);

  const toggleFavorite = (e: React.MouseEvent, item: Station) => {
    e.stopPropagation();
    setFavorites(prev => {
      const isFav = prev.some(f => f.id === item.id);
      const newFavs = isFav ? prev.filter(f => f.id !== item.id) : [...prev, item];
      localStorage.setItem('radio_tv_favs', JSON.stringify(newFavs));
      return newFavs;
    });
  };

  useEffect(() => {
    localStorage.setItem('radio_tv_country', country);
    localStorage.setItem('tv_source', tvSource);

    // Attempt to load from cache first
    const cachedRadio = localStorage.getItem(`cache_radio_${country}`);
    const cachedTv = localStorage.getItem(`cache_tv_${country}_src${tvSource}`);
    let hasCache = false;

    if (cachedRadio) {
      try { setStations(JSON.parse(cachedRadio)); hasCache = true; } catch (e) { }
    }
    if (cachedTv) {
      try { setTvChannels(JSON.parse(cachedTv)); hasCache = true; } catch (e) { }
    }

    if (!hasCache) {
      setLoading(true);
    } else {
      setLoading(false); // Instantly show cache, still fetch in background
    }

    fetchRadio();
    fetchTV();
  }, [country, tvSource]);

  const fetchRadio = async () => {
    try {
      const selectedCountry = COUNTRIES.find(c => c.code === country)?.radioName || 'Russia';
      const res = await fetch(`https://de1.api.radio-browser.info/json/stations/search?limit=500&country=${selectedCountry}&hidebroken=true&order=votes&reverse=true`);
      const data = await res.json();

      const parsed: Station[] = data.map((d: any) => ({
        id: d.stationuuid,
        name: d.name,
        url: d.url_resolved,
        logo: d.favicon || '',
        group: d.tags,
        type: 'radio'
      })).filter((s: Station) => s.url);

      setStations(parsed);
      localStorage.setItem(`cache_radio_${country}`, JSON.stringify(parsed));
    } catch (e) {
      console.error("Failed to fetch radio", e);
    }
  };

  const fetchTV = async () => {
    try {
      // 1. Fetch remote config
      let config;
      try {
        const confRes = await fetch('/tv-config.json?t=' + Date.now());
        config = await confRes.json();
      } catch (e) {
        // Default config if fetch fails
        config = {
          tvPlaylists: {
            [country]: [
              `https://iptv-org.github.io/iptv/countries/${country}.m3u`,
              `https://raw.githubusercontent.com/romaxa55/world_ip_tv/master/output/${country}.m3u`,
              `https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_${FREE_TV_MAP[country] || country}.m3u8`
            ]
          },
          fastPlaylists: {
            pluto: "https://i.mjh.nz/PlutoTV/us.m3u8",
            samsung: "https://i.mjh.nz/SamsungTVPlus/us.m3u8",
            plex: "https://i.mjh.nz/Plex/us.m3u8",
            pbs: "https://i.mjh.nz/PBS/all.m3u8"
          }
        };
      }

      let url = '';
      let needsProxy = false;
      const sourceIndex = parseInt(tvSource) - 1;
      const countryList = config.tvPlaylists?.[country] || config.tvPlaylists?.['ru'] || [
        `https://iptv-org.github.io/iptv/countries/${country}.m3u`
      ];
      url = countryList[sourceIndex] || countryList[0];

      if (!url) throw new Error("URL not found in config");

      const fetchUrl = needsProxy ? `/api/proxy?url=${encodeURIComponent(url)}` : url;
      const res = await fetch(fetchUrl);
      
      let resText = '';
      if (!res.ok && tvSource === '3' && !needsProxy) {
        // Fallback if country playlist doesn't exist in Free-TV
        const fbRes = await fetch(`https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8`);
        resText = await fbRes.text();
      } else {
        resText = await res.text();
      }

      const parseM3u = (text: string, sourceUrl: string) => {
        const lines = text.split('\n');
        const channels: Station[] = [];
        let current: Partial<Station> = {};

        lines.forEach(line => {
          if (line.startsWith('#EXTINF:')) {
            const logoMatch = line.match(/tvg-logo="([^"]+)"/);
            const groupMatch = line.match(/group-title="([^"]+)"/);
            const name = line.split(',').pop()?.trim() || 'Unknown';

            current = {
              id: Math.random().toString(36).substring(7),
              name,
              logo: logoMatch ? logoMatch[1] : '',
              group: groupMatch ? groupMatch[1] : '',
              type: 'tv'
            };
          } else if (line.startsWith('http')) {
            if (current.name) {
              const streamUrl = line.trim();
              
              if (streamUrl.startsWith('https://')) {
                // HTTPS goes directly
                channels.push({ ...current, url: streamUrl, isHttp: false, originalUrl: sourceUrl } as Station);
              } else {
                // HTTP goes through Cloudflare Pages Function to avoid Mixed Content
                // Встроенный прокси Cloudflare Pages
                const WORKER_URL = "/api/proxy";
                
                channels.push({ 
                  ...current, 
                  url: `${WORKER_URL}?url=${encodeURIComponent(streamUrl)}`, 
                  isHttp: true,
                  originalUrl: sourceUrl
                } as Station);
              }
              current = {};
            }
          }
        });
        return channels;
      };

      const parsedTv = parseM3u(resText, url);
      
      // Load backup playlists for fallback logic
      if (!['pluto', 'samsung', 'plex', 'pbs'].includes(tvSource)) {
         const countryList = config.tvPlaylists[country] || [];
         if (countryList.length > 1) {
            // We can fetch backups in the background, but for now we'll just save the config
            (window as any)._tvConfig = config;
            (window as any)._tvCountry = country;
         }
      }

      setTvChannels(parsedTv);
      localStorage.setItem(`cache_tv_${country}_src${tvSource}`, JSON.stringify(parsedTv));
    } catch (e) {
      console.error("Failed to fetch TV", e);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayRadio = (station: Station) => {
    // If a TV channel is playing, stop it
    setActiveTvChannel(null);

    // Radio plays DIRECTLY — no proxy needed.
    // Browser allows cross-origin <audio src>, and proxying infinite
    // audio streams would overload the backend.
    playTrack({
      id: station.id,
      title: station.name,
      artist: station.group || 'Live Radio',
      url: station.url,
      coverUrl: station.logo,
      type: 'radio'
    });
  };

  const handlePlayTv = (channel: Station) => {
    // Stop global audio when TV plays
    stop();
    setTvError(false);
    setTvLoading(true);

    // channel.url is already processed by parseM3u (HTTP streams use Cloudflare proxy)
    // We play it directly first. If it's HTTPS and fails (e.g. CORS), the fallback logic will catch it.
    setActiveTvChannel({ ...channel, originalUrl: channel.url });
  };

  const tryAlternativeTvSource = async (channel: Station) => {
    const config = (window as any)._tvConfig;
    const c = (window as any)._tvCountry;
    if (!config || !c || !config.tvPlaylists?.[c]) return false;

    const currentSourceIndex = parseInt(tvSource) - 1;
    if (isNaN(currentSourceIndex)) return false; // not a numbered source

    const lists = config.tvPlaylists[c];
    if (lists.length <= 1) return false;

    const nextIndex = (currentSourceIndex + 1) % lists.length;
    if (nextIndex === currentSourceIndex) return false;

    try {
      const res = await fetch(lists[nextIndex]);
      const text = await res.text();
      
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // very basic matching, real names can differ slightly but usually close
        if (lines[i].toLowerCase().includes(channel.name.toLowerCase())) {
          for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
            if (lines[j].startsWith('http')) {
              const newUrl = lines[j].trim();
              const proxied = newUrl.startsWith('https://') 
                ? newUrl 
                : `/api/proxy?url=${encodeURIComponent(newUrl)}`;

              setActiveTvChannel({ 
                ...channel, 
                url: proxied, 
                originalUrl: newUrl, 
                isHttp: !newUrl.startsWith('https://') 
              } as Station);
              setTvError(false);
              return true;
            }
          }
        }
      }
    } catch (e) {
      return false;
    }
    return false;
  };

  // Infinite scroll for Radio / TV
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const windowH = window.innerHeight;
      const docH = document.documentElement.scrollHeight;
      if (scrollY + windowH >= docH - 100) {
        setVisibleCount(v => v + 50);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // HLS logic
  useEffect(() => {
    let playbackTimeout: ReturnType<typeof setTimeout> | null = null;
    let networkRetries = 0;
    const MAX_NETWORK_RETRIES = 2;

    if (activeTvChannel && activeTab === 'tv' && videoRef.current) {
      const video = videoRef.current;
      const url = activeTvChannel.url;

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      // Timeout: if nothing plays within 25s, show error
      // (12s was too short, many free streams take 15-20s to load)
      playbackTimeout = setTimeout(() => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        setTvError(true);
        setTvLoading(false);
      }, 25000);

      const clearPlaybackTimeout = () => {
        if (playbackTimeout) {
          clearTimeout(playbackTimeout);
          playbackTimeout = null;
        }
      };

      if (Hls.isSupported()) {
        const hls = new Hls({
          maxBufferLength: 30,           // Smaller for faster start
          maxMaxBufferLength: 60,
          enableWorker: true,
          lowLatencyMode: false,         // Disabled: breaks many standard free streams
          manifestLoadingTimeOut: 20000,  // More time for slow sources
          levelLoadingTimeOut: 20000,
          fragLoadingTimeOut: 20000,
          xhrSetup: (xhr: XMLHttpRequest) => {
            xhr.withCredentials = false;  // For CORS
          }
        });
        hlsRef.current = hls;

        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(e => console.log('Autoplay prevented', e));
        });

        // Clear timeout once video actually plays
        video.addEventListener('playing', clearPlaybackTimeout, { once: true });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                networkRetries++;
                if (networkRetries <= MAX_NETWORK_RETRIES) {
                  console.error(`fatal network error, retry ${networkRetries}/${MAX_NETWORK_RETRIES}`);
                  hls.startLoad();
                } else {
                  // Fallback: If we were playing direct HTTPS and it failed (CORS/etc),
                  // let's try wrapping it in our Cloudflare proxy
                  if (activeTvChannel && !activeTvChannel.url.includes('/api/proxy')) {
                    console.log('[TV] Stream failed, trying Cloudflare proxy fallback...');
                    clearPlaybackTimeout();
                    hls.destroy();
                    hlsRef.current = null;
                    networkRetries = 0;
                    
                    const proxiedUrl = `/api/proxy?url=${encodeURIComponent(activeTvChannel.url)}`;
                    setActiveTvChannel(prev => prev ? { ...prev, url: proxiedUrl } : null);
                  } else {
                    console.error('fatal network error, max retries reached');
                    clearPlaybackTimeout();
                    hls.destroy();
                    hlsRef.current = null;
                    
                    if (activeTvChannel) {
                      tryAlternativeTvSource(activeTvChannel).then((found) => {
                        if (!found) {
                          setTvError(true);
                          setTvLoading(false);
                        }
                      });
                    } else {
                      setTvError(true);
                      setTvLoading(false);
                    }
                  }
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.error('fatal media error encountered, try to recover');
                hls.recoverMediaError();
                break;
              default:
                // Same fallback logic for other fatal errors
                if (activeTvChannel && !activeTvChannel.url.includes('/api/proxy')) {
                  console.log('[TV] Media error, trying Cloudflare proxy fallback...');
                  clearPlaybackTimeout();
                  hls.destroy();
                  hlsRef.current = null;
                  networkRetries = 0;
                  
                  const proxiedUrl = `/api/proxy?url=${encodeURIComponent(activeTvChannel.url)}`;
                  setActiveTvChannel(prev => prev ? { ...prev, url: proxiedUrl } : null);
                } else {
                  console.error('fatal media error, max retries reached');
                  clearPlaybackTimeout();
                  hls.destroy();
                  hlsRef.current = null;
                  
                  if (activeTvChannel) {
                    tryAlternativeTvSource(activeTvChannel).then((found) => {
                      if (!found) {
                        setTvError(true);
                        setTvLoading(false);
                      }
                    });
                  } else {
                    setTvError(true);
                    setTvLoading(false);
                  }
                }
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.addEventListener('playing', clearPlaybackTimeout, { once: true });
        video.addEventListener('loadedmetadata', () => {
          video.play().catch(e => console.log('Autoplay prevented', e));
        });
      }
    }

    return () => {
      if (playbackTimeout) clearTimeout(playbackTimeout);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeTvChannel, activeTab]);

  const listToRender = activeTab === 'radio' ? stations : tvChannels;
  const filteredList = listToRender.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  const displayedList = filteredList.slice(0, visibleCount);

  return (
    <div 
      className="p-4 flex flex-col h-full"
      style={{ paddingTop: 'calc(6rem + env(safe-area-inset-top))' }}
    >
      <Header />
      <ExoClickMainBanner />

      {/* Top Navigation */}
      <div className="flex gap-2 mb-6 bg-black/20 p-1 rounded-xl overflow-x-auto hide-scrollbar">
        {[
          { id: 'movie', label: t('movies') },
          { id: 'series', label: t('series') },
          { id: 'radio', label: t('radio_and_tv') },
          ...((WebApp.platform === 'unknown' && !(window as any).Capacitor) ? [{ id: 'private', label: t('secretRoomTab') }] : [])
        ].map(tab => (
          <button
            key={tab.id}
            onClick={(e) => {
              if (tab.id === 'private') {
                e.preventDefault();
                window.location.href = 'https://moviemaniak5555.xyz/?app=adult';
                return;
              }
              if (tab.id === 'movie') {
                navigate('/', { state: { tab: 'movie' } });
              } else if (tab.id === 'series') {
                navigate('/', { state: { tab: 'series' } });
              }
            }}
            className="px-3 py-2 flex-1 text-sm font-bold rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
            style={{ 
              backgroundColor: tab.id === 'radio' ? 'var(--button-color)' : 'transparent',
              color: tab.id === 'radio' ? 'var(--button-text-color)' : 'var(--text-color)'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TV Warning */}
      {showTvWarning && activeTab === 'tv' && (
        <div className="mb-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-500 text-sm font-medium text-center animate-pulse">
          {t('tvWarning')}
        </div>
      )}

      {/* Country & Source Filters */}
      <div className="mb-4 flex gap-2">
        <select
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setVisibleCount(50);
          }}
          className="flex-1 p-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
          style={{
            backgroundColor: 'var(--bg-color)',
            color: 'var(--text-color)',
            borderColor: 'var(--hint-color)'
          }}
        >
          {COUNTRIES.map(c => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>

        {activeTab === 'tv' && (
          <select
            value={tvSource}
            onChange={(e) => setTvSource(e.target.value)}
            className="flex-1 p-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
            style={{
              backgroundColor: 'var(--bg-color)',
              color: 'var(--text-color)',
              borderColor: 'var(--hint-color)'
            }}
          >
            <optgroup label="Community IPTV">
              <option value="1">{t('source1')}</option>
              <option value="2">{t('source2')}</option>
              <option value="3">{t('source3')}</option>
            </optgroup>
          </select>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder={t('searchPlaceholderRadio')}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setVisibleCount(50);
        }}
        className="w-full p-3 rounded-xl mb-4 border focus:outline-none focus:ring-2 focus:ring-blue-500"
        style={{
          backgroundColor: 'var(--bg-color)',
          color: 'var(--text-color)',
          borderColor: 'var(--hint-color)'
        }}
      />

      {/* TV Player Modal/Inline */}
      {activeTvChannel && activeTab === 'tv' && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-black/90 backdrop-blur-md flex justify-between items-center p-4 border-b border-white/10 z-20 absolute top-0 left-0 right-0">
            <div className="flex items-center gap-3">
              {activeTvChannel.logo && <img src={activeTvChannel.logo} className="w-10 h-10 rounded-full shadow-md bg-white/10" />}
              <span className="font-bold text-white text-lg truncate shadow-sm drop-shadow-md">{activeTvChannel.name}</span>
            </div>
            <button
              onClick={() => setActiveTvChannel(null)}
              className="text-white bg-white/10 hover:bg-white/20 rounded-full w-10 h-10 flex items-center justify-center transition-colors"
            >
              ✕
            </button>
          </div>
          <div className="relative w-full h-full flex items-center justify-center pt-16 pb-4">
            {tvError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white px-4 text-center">
                <span className="text-4xl mb-3">⚠️</span>
                <p className="font-bold text-xl">Stream Unavailable</p>
                <p className="text-sm opacity-70 mt-2 max-w-sm">The channel might be blocked by CORS, Geo-restrictions, or is currently offline.</p>
                <button
                  onClick={() => {
                    if (activeTvChannel?.originalUrl) {
                      setTvError(false);
                      setTvLoading(true);
                      // Retry with original URL
                      setActiveTvChannel(prev => prev ? { ...prev, url: prev.originalUrl! } : null);
                    }
                  }}
                  className="mt-4 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold transition-colors"
                >
                  🔄 Retry
                </button>
              </div>
            ) : (
              <>
                {tvLoading && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
                    <div className="w-12 h-12 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
                <video
                  ref={videoRef}
                  autoPlay
                  controls
                  playsInline
                  className={`w-full h-full object-contain z-10 ${tvLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}
                  onError={() => { setTvError(true); setTvLoading(false); }}
                  onCanPlay={() => setTvLoading(false)}
                  onPlaying={() => setTvLoading(false)}
                  onLoadStart={() => setTvLoading(true)}
                  onWaiting={() => setTvLoading(true)}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-8">
        {loading ? (
          <div className="text-center opacity-50 mt-10" style={{ color: 'var(--text-color)' }}>{t('loading')}</div>
        ) : filteredList.length === 0 ? (
          <div className="text-center opacity-50 mt-10" style={{ color: 'var(--text-color)' }}>{t('notFound')}</div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pb-24">
            {displayedList.map((item, idx) => {
              const isRadioActive = activeTab === 'radio' && currentTrack?.id === item.id;
              const isTvActive = activeTab === 'tv' && activeTvChannel?.id === item.id;
              const isActive = isRadioActive || isTvActive;

              return (
                <React.Fragment key={item.id}>
                  <div
                    onClick={() => activeTab === 'radio' ? handlePlayRadio(item) : handlePlayTv(item)}
                    className={`aspect-[4/3] relative p-2 rounded-xl flex flex-col items-center justify-center text-center gap-1 transition-all cursor-pointer border ${isActive ? 'ring-2 ring-blue-500 scale-[0.98]' : 'hover:scale-[0.99]'}`}
                    style={{
                      backgroundColor: 'var(--secondary-bg-color, rgba(100, 100, 100, 0.05))',
                      borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.1))'
                    }}
                  >
                    {activeTab === 'tv' && item.isHttp && (
                      <div className="absolute top-1 right-1 text-[8px] bg-orange-500/80 text-white px-1.5 py-0.5 rounded shadow-sm z-10 font-bold backdrop-blur-md">
                        APP
                      </div>
                    )}
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gray-200 dark:bg-gray-800 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm mt-1">
                      {item.logo ? (
                        <img src={item.logo} alt={item.name} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                      ) : (
                        <span className="text-2xl sm:text-3xl">{activeTab === 'radio' ? '📻' : '📺'}</span>
                      )}
                    </div>

                    <div className="w-full flex-1 min-w-0 mt-1">
                      <div className="font-bold truncate text-[10px] sm:text-xs" style={{ color: 'var(--text-color)' }}>
                        {item.name}
                      </div>
                      {item.group && (
                        <div className="text-[10px] opacity-60 truncate" style={{ color: 'var(--text-color)' }}>
                          {item.group}
                        </div>
                      )}
                    </div>

                    <div className="flex w-full justify-between items-center px-1 mt-auto">
                      <button
                        onClick={(e) => toggleFavorite(e, item)}
                        className="text-xl hover:scale-110 transition-transform p-1"
                        style={{ color: favorites.some(f => f.id === item.id) ? '#fbbf24' : 'var(--hint-color)' }}
                      >
                        {favorites.some(f => f.id === item.id) ? (
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-md">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        ) : (
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="transparent" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-md opacity-90 hover:opacity-100">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                        )}
                      </button>
                      <span style={{ color: 'var(--text-color)' }} className="text-sm p-1">
                        {isActive ? (
                          <div className="w-2 h-2 rounded-full bg-blue-500 mr-2 animate-pulse"></div>
                        ) : (
                          '›'
                        )}
                      </span>
                    </div>
                  </div>
                  {shouldShowAd(idx) && <ExoClickWhiteAd zoneId="5965876" className="exo-banner-movie-card w-full rounded-xl overflow-hidden" />}
                </React.Fragment>
              );
            })}
          </div>
        )}
        {loading && filteredList.length === 0 && (
          <div className="flex justify-center mt-6">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>
    </div>
  );
}
