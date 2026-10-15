import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAudioPlayer } from '../context/AudioPlayerContext';
import { useLanguage } from '../context/LanguageContext';
import { WebApp } from '../telegram';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { BannerAd } from '../components/BannerAd';
import { EXPRESS_API_BASE } from '../hooks/useApi';
import { clientCache } from '../utils/clientCache';
import { triggerViewportExpand } from '../hooks/useViewportExpand';
import { favoritesManager } from '../utils/favoritesManager';

export interface Station {
  id: string;
  name: string;
  url: string;
  logo: string;
  group?: string;
  type?: 'radio';
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

export function RadioContent() {
  const [country, setCountry] = useState(() => {
    const saved = localStorage.getItem('radio_country');
    if (saved) return saved;
    const tgLang = WebApp.initDataUnsafe?.user?.language_code;
    if (tgLang === 'ko') return 'kr';
    if (tgLang === 'id') return 'id';
    if (tgLang === 'hi') return 'in';
    if (tgLang === 'fa') return 'ir';
    return 'ru';
  });

  const [radioSource, setRadioSource] = useState(localStorage.getItem('radio_source') || '1');
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  const inFlightControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const [favIds, setFavIds] = useState<Set<string>>(() => {
    try {
      const list = favoritesManager.getLocal('radio');
      return new Set(list.map((i: any) => String(i.id)));
    } catch (_) {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      const list = favoritesManager.getLocal('radio');
      setFavIds(new Set(list.map((i: any) => String(i.id))));
    } catch (_) {}
  }, []);

  const toggleFavorite = (item: Station, e: React.MouseEvent) => {
    e.stopPropagation();
    const itemId = String(item.id);
    const isFav = favIds.has(itemId);
    if (isFav) {
      favoritesManager.remove('radio', item.id);
      setFavIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    } else {
      favoritesManager.add('radio', item);
      setFavIds(prev => new Set(prev).add(itemId));
    }
    try {
      WebApp?.HapticFeedback?.impactOccurred('light');
    } catch (_) {}
  };

  const { playTrack, currentTrack } = useAudioPlayer();
  const { t } = useLanguage();

  useEffect(() => {
    localStorage.setItem('radio_country', country);
    localStorage.setItem('radio_source', radioSource);

    if (inFlightControllerRef.current) {
      inFlightControllerRef.current.abort();
    }
    const ctrl = new AbortController();
    inFlightControllerRef.current = ctrl;
    const currentRequestId = ++requestIdRef.current;

    const radioCacheKey = `cache_radio_${country}_src${radioSource}`;

    // 1. Synchronous check (RAM / localStorage)
    const cachedRadio = clientCache.get<Station[]>(radioCacheKey);
    const hasRadioCache = Boolean(cachedRadio && Array.isArray(cachedRadio) && cachedRadio.length > 0);

    if (hasRadioCache) {
      setStations(cachedRadio!);
      setLoading(false);
    } else {
      setStations([]);
      setLoading(true);
      // Fast non-blocking disk read from IndexedDB
      clientCache.getAsync<Station[]>(radioCacheKey).then(idbRadio => {
        if (ctrl.signal.aborted || requestIdRef.current !== currentRequestId) return;
        if (idbRadio && Array.isArray(idbRadio) && idbRadio.length > 0) {
          setStations(idbRadio);
          setLoading(false);
        }
      }).catch(() => {});
    }

    fetchRadio(ctrl.signal);

    return () => {
      ctrl.abort();
    };
  }, [country, radioSource]);

  const fetchRadio = async (signal?: AbortSignal) => {
    try {
      let parsed: Station[] = [];

      // 1. Fetch from backend API
      try {
        const res = await fetchWithRetry(`${EXPRESS_API_BASE}/radio/stations?country=${encodeURIComponent(country)}&source=${encodeURIComponent(radioSource)}`, { maxRetries: 1, signal });
        if (res && res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            parsed = data;
          }
        }
      } catch (e) {
        console.warn('[Radio] Backend fetch failed, attempting client fallback...', e);
      }

      // 2. Direct client fallback
      if (parsed.length === 0) {
        if (country === 'ru' && radioSource === '1') {
          try {
            const res = await fetch('/radiopotok.json');
            if (res.ok) {
              const data = await res.json();
              parsed = data.map((d: any, idx: number) => ({
                id: d.id || `rp_${idx}_${d.name ? d.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ]/g, '') : idx}`,
                name: d.name,
                url: d.stream,
                logo: d.logo || '',
                group: '',
                type: 'radio' as const
              })).filter((s: Station) => s.url);
            }
          } catch (e) {}
        }

        if (parsed.length === 0) {
          const selectedCountry = COUNTRIES.find(c => c.code === country)?.radioName || 'Russia';
          const RADIO_MIRRORS = [
            'de1.api.radio-browser.info',
            'nl1.api.radio-browser.info',
            'at1.api.radio-browser.info'
          ];

          for (const mirror of RADIO_MIRRORS) {
            try {
              const res = await fetchWithRetry(`https://${mirror}/json/stations/search?limit=500&country=${encodeURIComponent(selectedCountry)}&hidebroken=true&order=votes&reverse=true`, { maxRetries: 1 });
              if (res && res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                  parsed = data.map((d: any) => ({
                    id: d.stationuuid,
                    name: d.name,
                    url: d.url_resolved,
                    logo: d.favicon || '',
                    group: d.tags,
                    type: 'radio' as const
                  })).filter((s: Station) => s.url);
                  break;
                }
              }
            } catch (err) {}
          }
        }
      }

      if (signal?.aborted) return;

      if (parsed.length > 0) {
        setStations(parsed);
        clientCache.set(`cache_radio_${country}_src${radioSource}`, parsed, 604800);
      }
      setLoading(false);
    } catch (e) {
      console.error('Failed to fetch radio', e);
      setLoading(false);
    }
  };

  const handlePlayRadio = (station: Station) => {
    try {
      WebApp?.HapticFeedback?.impactOccurred('medium');
    } catch (_) {}

    const finalUrl = station.url?.startsWith('http://')
      ? `${EXPRESS_API_BASE}/proxy?url=${encodeURIComponent(station.url)}`
      : station.url;

    playTrack({
      id: station.id,
      title: station.name,
      artist: (station.group && station.group !== 'Radiopotok') ? station.group : 'Live Radio',
      url: finalUrl,
      coverUrl: station.logo,
      type: 'radio'
    });

    favoritesManager.addHistory('radio', station);
  };

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stations;
    return stations.filter(s => s.name.toLowerCase().includes(q) || (s.group && s.group.toLowerCase().includes(q)));
  }, [stations, search]);

  const displayedList = useMemo(() => filteredList.slice(0, visibleCount), [filteredList, visibleCount]);

  return (
    <div className="flex flex-col h-full">
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

        <select
          value={radioSource}
          onChange={(e) => setRadioSource(e.target.value)}
          className="flex-1 p-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
          style={{
            backgroundColor: 'var(--bg-color)',
            color: 'var(--text-color)',
            borderColor: 'var(--hint-color)'
          }}
        >
          {country === 'ru' && <option value="1">{t('source1')}</option>}
          <option value={country === 'ru' ? "2" : "1"}>{country === 'ru' ? t('source2') : t('source1')}</option>
        </select>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder={t('searchPlaceholderRadio')}
        value={search}
        maxLength={100}
        onChange={(e) => {
          setSearch(e.target.value);
          setVisibleCount(50);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          requestAnimationFrame(() => {
            triggerViewportExpand();
          });
        }}
        className="w-full p-3 rounded-xl mb-4 border focus:outline-none focus:ring-2 focus:ring-blue-500"
        style={{
          backgroundColor: 'var(--bg-color)',
          color: 'var(--text-color)',
          borderColor: 'var(--hint-color)'
        }}
      />

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-8">
        {loading && stations.length === 0 ? (
          <div className="text-center opacity-50 mt-10" style={{ color: 'var(--text-color)' }}>{t('loading')}</div>
        ) : filteredList.length === 0 ? (
          <div className="text-center opacity-50 mt-10" style={{ color: 'var(--text-color)' }}>{t('notFound')}</div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pb-24">
            {displayedList.map((item, idx) => {
              const isActive = currentTrack?.id === item.id;

              return (
                <React.Fragment key={item.id}>
                  <div
                    onClick={() => handlePlayRadio(item)}
                    className={`aspect-[4/3] relative p-2 rounded-xl flex flex-col items-center justify-center text-center gap-1 transition-all cursor-pointer border ${isActive ? 'ring-2 ring-blue-500 scale-[0.98]' : 'hover:scale-[0.99]'}`}
                    style={{
                      backgroundColor: 'var(--secondary-bg-color, rgba(100, 100, 100, 0.05))',
                      borderColor: 'var(--hint-color, rgba(150, 150, 150, 0.1))'
                    }}
                  >
                    <button
                      onClick={(e) => toggleFavorite(item, e)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-xs transition-transform active:scale-125 z-10"
                      style={{
                        backgroundColor: favIds.has(String(item.id)) ? 'rgba(234, 179, 8, 0.25)' : 'rgba(0, 0, 0, 0.25)',
                        color: favIds.has(String(item.id)) ? '#eab308' : 'rgba(255, 255, 255, 0.45)',
                      }}
                      title={favIds.has(String(item.id)) ? (t('removeFromFavorites') || 'Remove from favorites') : (t('addToFavorites') || 'Add to favorites')}
                    >
                      {favIds.has(String(item.id)) ? '★' : '☆'}
                    </button>

                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gray-200 dark:bg-gray-800 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-sm mt-1">
                      {item.logo ? (
                        <img 
                          src={item.logo} 
                          alt={item.name} 
                          className="w-full h-full object-cover" 
                          loading="lazy"
                          decoding="async"
                          onError={(e) => (e.currentTarget.style.display = 'none')} 
                        />
                      ) : (
                        <span className="text-2xl sm:text-3xl">📻</span>
                      )}
                    </div>

                    <div className="w-full flex-1 min-w-0 mt-1">
                      <div className="font-bold truncate text-[10px] sm:text-xs" style={{ color: 'var(--text-color)' }}>
                        {item.name}
                      </div>
                    </div>

                    <div className="flex w-full justify-between items-center px-1 mt-auto">
                      <span style={{ color: 'var(--text-color)' }} className="text-sm p-1 ml-auto">
                        {isActive ? (
                          <div className="w-2 h-2 rounded-full bg-blue-500 mr-2 animate-pulse"></div>
                        ) : (
                          '›'
                        )}
                      </span>
                    </div>
                  </div>
                  {idx === 8 && (
                    <div className="col-span-full w-full flex justify-center my-2">
                      <BannerAd />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
