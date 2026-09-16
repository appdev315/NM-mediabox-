import React, { useState, useEffect, useRef, useCallback, lazy, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, type Genre, CF_API_BASE } from '../hooks/useApi';
import { clientCache } from '../utils/clientCache';
import { prewarmStream } from '../utils/streamPreloader';
import { AvailBadge } from '../components/AvailBadge';
import { useLanguage, countriesList } from '../context/LanguageContext';
import { useAdManager } from '../context/AdManager';
import { Header } from '../components/Header';
const RadioTVContent = lazy(() => import('./RadioTV').then(m => ({ default: m.RadioTVContent })));
import { TrailerFeed } from '../components/TrailerFeed';
import { TrailerStoriesBar } from '../components/TrailerStoriesBar';
import { WebApp } from '../telegram';
import { useHomeState } from '../context/HomeStateContext';
import { MovieBottomBanner } from '../components/MovieBottomBanner';
import { BannerAd } from '../components/BannerAd';
import { AdsterraNativeCard } from '../components/AdsterraNativeCard';

interface MovieCardProps {
  item: any;
  mediaType: string;
  selectedCountry?: string;
  comingSoonText: string;
  onNavigate: (id: string | number, mediaType: string, country?: string, meta?: any) => void;
}

const MovieCard = React.memo(function MovieCard({
  item,
  mediaType,
  selectedCountry,
  comingSoonText,
  onNavigate,
}: MovieCardProps) {
  if (!item || !item.id) return null;
  const targetMediaType = item.type || mediaType;

  const posterSrcSet = React.useMemo(() => {
    if (!item.poster || typeof item.poster !== 'string') return undefined;
    const match = item.poster.match(/\/t\/p\/[^\/]+(\/.+)$/);
    if (!match) return undefined;
    const cleanPath = match[1];
    const isProxied = item.poster.includes('/api/image') || item.poster.includes('workers.dev');
    const base = isProxied ? `${CF_API_BASE}/image?path=/t/p` : 'https://image.tmdb.org/t/p';
    return `${base}/w185${cleanPath} 185w, ${base}/w342${cleanPath} 342w`;
  }, [item.poster]);

  return (
    <div 
      onPointerDown={() => {
        if (!item.isAdult) prewarmStream(item.id, item);
      }}
      onClick={(e) => {
        e.stopPropagation();
        (document.activeElement as HTMLElement)?.blur();
        if (!item.isAdult) prewarmStream(item.id, item);
        onNavigate(item.id, targetMediaType, selectedCountry, {
          title: item.title || item.name,
          year: item.year,
          liftw_id: item.liftw_id
        });
      }}
      className="flex flex-col gap-2 cursor-pointer group relative z-10 card-hover rounded-xl"
    >
      <div className="relative overflow-hidden rounded-xl shadow-sm aspect-[2/3] bg-[var(--hint-color)]">
        {item.isUpcoming && (
          <div className="absolute top-2 left-2 z-20">
            <span className="bg-amber-500 text-black text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md shadow-md flex items-center gap-1 border border-amber-400/40">
              ⏳ {comingSoonText}
            </span>
          </div>
        )}
        {item.isAdult && (
          <div className="absolute top-2 left-2 z-20">
            <span className="bg-red-600 text-white text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md shadow-md flex items-center gap-1 border border-red-500/40">
              🔞 18+
            </span>
          </div>
        )}
        <img 
          src={item.poster} 
          srcSet={posterSrcSet}
          sizes="(max-width: 640px) 170px, 342px"
          alt={item.title} 
          width={300}
          height={450}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            const currentSrc = e.currentTarget.src;
            if (currentSrc && currentSrc.includes('image.tmdb.org') && !e.currentTarget.dataset.proxied) {
              e.currentTarget.dataset.proxied = 'true';
              const match = currentSrc.match(/\/t\/p\/[^\/]+\/.+$/);
              if (match) {
                e.currentTarget.src = `${CF_API_BASE}/image?path=${match[0]}`;
                return;
              }
            }
            if (currentSrc && currentSrc.includes('thumb-cdn77.xvideos-cdn.com')) {
              e.currentTarget.src = currentSrc.replace('thumb-cdn77.xvideos-cdn.com', 'thumbs-gcore.xvideos-cdn.com');
              return;
            }
            e.currentTarget.onerror = null;
            e.currentTarget.src = item.isAdult
              ? 'https://placehold.co/400x300/242f3d/ffffff?text=18+'
              : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="300" height="450" fill="%23242f3d"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23ffffff" font-size="18" font-family="sans-serif">No Poster</text></svg>';
          }}
        />
        {item.duration && (
          <div className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md z-20">
            {item.duration}
          </div>
        )}
        {!item.isAdult && <AvailBadge type={targetMediaType} id={item.id} />}
      </div>
      <div className="mt-1 px-1">
        <h3 className="font-bold text-sm leading-tight line-clamp-1 break-words">{item.title}</h3>
        <p className="text-[11px] opacity-70 mt-1 font-medium flex items-center gap-1.5 flex-wrap">
          {item.rating && item.rating > 0 && (
            <span className="flex items-center gap-1">
              <span 
                className="px-1 py-0.5 rounded text-[8px] font-black uppercase tracking-wider leading-none border" 
                style={{ borderColor: 'var(--text-color)', color: 'var(--text-color)' }}
              >
                IMDb
              </span>
              <span className="font-bold">{item.rating.toFixed(1)}</span>
            </span>
          )}
          {item.rating && item.rating > 0 && item.year && <span className="opacity-40">•</span>}
          {item.year && <span>{item.year}</span>}
        </p>
      </div>
    </div>
  );
});

export function Home() {
  const navigate = useNavigate();
  const { fetchMovies, fetchSeries, searchContent, fetchGenres, fetchCategorizedHome, fetchAdultSearch, loading } = useApi();
  const { language, t } = useLanguage();
  const { triggerAd } = useAdManager();

  const {
    activeTab,
    setActiveTab,
    selectedGenre,
    setSelectedGenre,
    selectedCountry,
    setSelectedCountry,
    page,
    setPage,
    items,
    setItems,
    homeSections,
    setHomeSections,
    searchQuery,
    setSearchQuery,
    isSearching,
    setIsSearching,
    scrollY,
    setScrollY
  } = useHomeState();

  const [genres, setGenres] = useState<Genre[]>([]);
  const [sortBy, setSortBy] = useState<'popularity.desc' | 'vote_average.desc'>('popularity.desc');
  const [searchInput, setSearchInput] = useState<string>(searchQuery);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [modalTrailerTarget, setModalTrailerTarget] = useState<{ id?: number; index?: number } | null>(null);
  const isFirstRender = useRef(true);
  const hasRestoredScrollRef = useRef(false);
  // Live search: debounce timer + abort for stale requests
  const searchDebounceRef = useRef<any>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      try { searchAbortRef.current?.abort(); } catch (_) {}
    };
  }, []);

  const currentFilterLabel = useMemo(() => {
    if (selectedGenre) {
      if (selectedGenre === 'trending') return t('trending') || (language === 'ru-RU' ? '🔥 Популярное' : '🔥 Popular');
      if (selectedGenre === 'adult') return '🔞 18+';
      const gMatch = genres.find(g => String(g.id) === String(selectedGenre));
      if (gMatch) return gMatch.name;
      const sMatch = homeSections.find(s => String(s.genreId) === String(selectedGenre) || String(s.id) === String(selectedGenre));
      if (sMatch) return sMatch.name;
      return t('allGenres');
    }
    if (selectedCountry) {
      const cMatch = countriesList.find(c => c.code === selectedCountry);
      if (cMatch) return `${cMatch.flag} ${cMatch.name[language] || cMatch.name['en-US']}`;
    }
    if (sortBy === 'vote_average.desc') {
      return '⭐ Top IMDb';
    }
    return '';
  }, [selectedGenre, selectedCountry, sortBy, genres, homeSections, language, t]);

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (activeTab !== 'movie' && activeTab !== 'series' && activeTab !== 'radio' && activeTab !== 'tv') {
      setActiveTab('movie');
    }
  }, [activeTab, setActiveTab]);

  // Synchronous initial restore from client cache for 0ms loading state on tab switch
  useEffect(() => {
    if (activeTab !== 'radio' && activeTab !== 'tv' && searchQuery.trim().length === 0 && !selectedGenre && !selectedCountry && sortBy === 'popularity.desc' && page === 1 && homeSections.length === 0) {
      const cacheKey = `categorized_home_v5_${activeTab === 'movie' ? 'movie' : 'tv'}_${language}`;
      const cached = clientCache.get(cacheKey) as any[];
      if (Array.isArray(cached) && cached.length > 0) {
        setHomeSections(cached);
      }
    }
  }, [activeTab, language]);

  useEffect(() => {
    WebApp.expand();
    const platform = WebApp.platform || 'unknown';
    const isMobile = ['android', 'android_x', 'ios'].includes(platform);
    if (isMobile && WebApp.requestFullscreen) {
      WebApp.requestFullscreen();
    }
  }, []);

  // Fetch genres
  useEffect(() => {
    if (activeTab === 'radio' || activeTab === 'tv') return;
    fetchGenres(activeTab === 'movie' ? 'movie' : 'tv').then(setGenres);
  }, [activeTab, fetchGenres]);

  // Handle scroll position save and restore
  useEffect(() => {
    if (items.length > 0 || homeSections.length > 0) {
      if (!hasRestoredScrollRef.current && scrollY > 0) {
        window.scrollTo(0, scrollY);
        hasRestoredScrollRef.current = true;
      }
    }
  }, [items, homeSections, scrollY]);

  // Save scroll position on scroll with RAF throttling for 60/120fps UI performance
  useEffect(() => {
    let ticking = false;
    const handleScrollSave = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrollY(window.scrollY);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScrollSave, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScrollSave);
      setScrollY(window.scrollY);
    };
  }, [setScrollY]);

  // Load content
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (items.length > 0 || homeSections.length > 0) {
        return;
      }
    }

    const loadContent = async () => {
      try {
        if (activeTab === 'radio' || activeTab === 'tv') {
          return;
        }
        if (searchQuery.trim().length > 0) {
          setIsSearching(true);
          // Cancel stale live-search request before starting a new one
          try { searchAbortRef.current?.abort(); } catch (_) {}
          const ctrl = new AbortController();
          searchAbortRef.current = ctrl;
          try {
            const results = await searchContent(searchQuery, ctrl.signal);
            if (!ctrl.signal.aborted) setItems(results);
          } catch (err: any) {
            // Stale (aborted) searches are silently ignored
            if (!ctrl.signal.aborted) {
              console.error('Failed to search content', err);
              setItems([]);
            }
          }
        } else if (selectedGenre || selectedCountry || sortBy === 'vote_average.desc' || page > 1) {
          setIsSearching(false);
          if (selectedGenre === 'adult') {
            try {
              const randPage = Math.floor(Math.random() * 4);
              const data = await fetchAdultSearch('popular', randPage);
              const list = Array.isArray(data) ? data : [];
              const seen = new Set();
              const unique = list.filter((v: any) => {
                if (!v || !v.id || seen.has(v.id)) return false;
                seen.add(v.id);
                return true;
              });
              const shuffled = unique.sort(() => Math.random() - 0.5).slice(0, 15);
              const adultItems = shuffled.map((v: any) => ({
                id: v.id,
                title: v.title,
                poster: v.poster,
                type: 'adult',
                duration: v.duration,
                isAdult: true,
              }));
              setItems(adultItems);
            } catch (err) {
              console.error('Failed to load adult content', err);
              setItems([]);
            }
          } else {
            const results = activeTab === 'movie' 
              ? await fetchMovies(page, selectedGenre, selectedCountry, sortBy)
              : await fetchSeries(page, selectedGenre, selectedCountry, sortBy);
              
            if (page === 1) {
              setItems(results || []);
            } else {
              setItems(prev => {
                const existingIds = new Set(prev.map(i => i.id));
                const newItems = (results || []).filter((i: any) => !existingIds.has(i.id));
                return [...prev, ...newItems];
              });
            }
          }
        } else {
          // Default categorized home feed (12 cards per genre section, cached for 24 hours)
          setIsSearching(false);
          const cacheKey = `categorized_home_v5_${activeTab === 'movie' ? 'movie' : 'tv'}_${language}`;
          const cachedSync = clientCache.get(cacheKey) as any[];
          if (Array.isArray(cachedSync) && cachedSync.length > 0) {
            // Instant 0ms render from client cache
            setHomeSections(cachedSync);
            // Silent background update without triggering loading state
            fetchCategorizedHome(activeTab === 'movie' ? 'movie' : 'tv', true).then((fresh: any) => {
              if (Array.isArray(fresh) && fresh.length > 0) setHomeSections(fresh);
            });
          } else {
            const sections = await fetchCategorizedHome(activeTab === 'movie' ? 'movie' : 'tv');
            setHomeSections((sections as any[]) || []);
          }
        }
      } catch (err) {
        console.error('Failed to load content', err);
      }
    };

    loadContent();
  }, [activeTab, page, selectedGenre, selectedCountry, sortBy, searchQuery, fetchMovies, fetchSeries, searchContent, fetchCategorizedHome, language]);

  // Infinite scroll listener (active in single-genre, country, search, or Top IMDb mode for movies & series)
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (loading || isSearching || selectedGenre === 'adult' || (!selectedGenre && !selectedCountry && sortBy === 'popularity.desc' && !searchQuery)) return;
      
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollYPos = window.scrollY;
          const windowHeight = window.innerHeight;
          const documentHeight = document.documentElement.scrollHeight;
          
          if (scrollYPos + windowHeight >= documentHeight - 100) {
            setPage(p => p + 1);
          }
          ticking = false;
        });
        ticking = true;
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loading, isSearching, page, selectedGenre, selectedCountry, sortBy, searchQuery]);



  const handleTabChange = (tab: 'movie' | 'series' | 'radio' | 'tv') => {
    (document.activeElement as HTMLElement)?.blur();
    setActiveTab(tab);
    hasRestoredScrollRef.current = false;
    triggerAd();
  };

  const submitSearch = (raw: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const sanitized = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120);
    setSearchInput(sanitized);
    setSearchQuery(sanitized);
    setPage(1);
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    submitSearch(searchInput);
  };

  const handleClearSearch = () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchInput('');
    setSearchQuery('');
    setPage(1);
  };

  // Live search: debounce typing (min 2 chars), instant clear on empty
  const handleSearchInputChange = (val: string) => {
    setSearchInput(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const trimmed = val.trim();
    if (trimmed === '') {
      setSearchQuery('');
      setPage(1);
      return;
    }
    if (trimmed.length < 2) return;
    searchDebounceRef.current = setTimeout(() => {
      submitSearch(val);
    }, 2200);
  };

  const handleNavigate = useCallback((id: string | number, mediaType: string, country?: string, meta?: any) => {
    if (mediaType === 'adult') {
      navigate(`/adult/${id}`);
      return;
    }
    const countryQuery = country ? `&country=${country}` : '';
    navigate(`/movie/${id}?type=${mediaType}${countryQuery}`, { state: meta });
  }, [navigate]);

  const isCategorizedMode = !selectedGenre && !selectedCountry && sortBy === 'popularity.desc' && !isSearching && page === 1;

  return (
    <div 
      className="px-3 sm:px-4 pb-20"
      style={{ paddingTop: 'calc(5.2rem + env(safe-area-inset-top))' }}
    >
      {/* Header & Profile */}
      <Header />

      {/* Desktop Search Bar (Fixed directly to the right of MEDIABOX) */}
      <div 
        className="fixed left-[170px] top-[calc(16px+env(safe-area-inset-top))] z-40 hidden sm:flex items-center h-10 w-[240px] md:w-[320px] lg:w-[380px] rounded-xl border border-white/10 bg-gray-800 text-white shadow-xl px-3 transition-all"
      >
        <span className="pr-2 text-sm opacity-60 select-none">🔍</span>
        <input 
          type="text" 
          placeholder={t('searchPlaceholder')} 
          value={searchInput}
          maxLength={120}
          onChange={(e) => handleSearchInputChange(e.target.value)}
          onPaste={(e) => {
            const pastedText = e.clipboardData.getData('text');
            if (pastedText && /[\r\n\t]/.test(pastedText)) {
              e.preventDefault();
              const cleaned = pastedText.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
              const currentVal = searchInput;
              const target = e.target as HTMLInputElement;
              const start = target.selectionStart || 0;
              const end = target.selectionEnd || 0;
              const nextVal = (currentVal.slice(0, start) + cleaned + currentVal.slice(end)).slice(0, 120);
              setSearchInput(nextVal);
              handleSearchInputChange(nextVal);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
              handleSearchSubmit();
            } else if (e.key === 'Escape') {
              (e.target as HTMLInputElement).blur();
              handleClearSearch();
            }
          }}
          className="w-full py-1.5 pr-2 outline-none font-medium border-none bg-transparent text-sm min-w-0 text-white placeholder-white/50"
        />
        {searchInput && (
          <button
            type="button"
            onClick={handleClearSearch}
            className="pl-1 text-xs opacity-60 hover:opacity-100 transition-opacity cursor-pointer text-white"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {/* Mobile Search: Compact Magnifier Button next to MEDIABOX (sm:hidden) */}
      {!isMobileSearchOpen && (
        <button
          type="button"
          onClick={() => setIsMobileSearchOpen(true)}
          className="fixed left-[128px] top-[calc(16px+env(safe-area-inset-top))] z-40 w-10 h-10 rounded-full border border-white/10 bg-gray-800 text-white flex sm:hidden items-center justify-center cursor-pointer shadow-xl active:scale-95 transition-transform"
          aria-label="Open search"
          title="Поиск"
        >
          <span className="text-sm">🔍</span>
        </button>
      )}

      {/* Mobile Search: Full-width Overlay Header when expanded (sm:hidden) */}
      {isMobileSearchOpen && (
        <div 
          className="fixed left-3 right-3 top-[calc(16px+env(safe-area-inset-top))] z-50 h-11 rounded-xl border border-white/20 bg-gray-900/95 backdrop-blur-xl text-white flex sm:hidden items-center shadow-2xl px-3 animate-fade-in"
        >
          <span className="pr-2 text-sm opacity-60 select-none">🔍</span>
          <input 
            type="text" 
            autoFocus
            placeholder={t('searchPlaceholder')} 
            value={searchInput}
            maxLength={120}
            onChange={(e) => handleSearchInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
                handleSearchSubmit();
              } else if (e.key === 'Escape') {
                setIsMobileSearchOpen(false);
              }
            }}
            className="w-full py-1.5 pr-2 outline-none font-medium border-none bg-transparent text-sm min-w-0 text-white placeholder-white/50"
          />
          <button
            type="button"
            onClick={() => {
              handleClearSearch();
              setIsMobileSearchOpen(false);
            }}
            className="p-1 text-base opacity-70 hover:opacity-100 transition-opacity cursor-pointer text-white"
            aria-label="Close search"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Leaderboard Banner (Adaptive 728x90 Desktop / 320x50 Mobile) */}
      <MovieBottomBanner className="my-2" slotId="home-top" />

      {/* Top Stories Bar (Facebook / Instagram style stories for trailers) */}
      <TrailerStoriesBar onOpenFeed={(trailerId, idx) => setModalTrailerTarget({ id: trailerId, index: idx })} />

      {/* Top Navigation */}
      <div className="flex gap-2 mb-4 bg-black/20 p-1 rounded-xl overflow-x-auto hide-scrollbar">
        {[
          { id: 'movie', label: t('movies') },
          { id: 'series', label: t('series') },
          { id: 'radio', label: t('tab_radio') || 'Радио' },
          { id: 'tv', label: t('tab_tv') || 'ТВ' },
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
              handleTabChange(tab.id as 'movie' | 'series' | 'radio' | 'tv');
            }}
            className="px-3 py-2 flex-1 text-sm font-bold rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
            style={{ 
              backgroundColor: activeTab === tab.id ? 'var(--button-color)' : 'transparent',
              color: activeTab === tab.id ? 'var(--button-text-color)' : 'var(--text-color)',
              border: activeTab === tab.id ? '1.5px solid var(--button-color)' : '1.5px solid var(--button-color)',
              opacity: activeTab === tab.id ? 1 : 0.85
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(activeTab === 'radio' || activeTab === 'tv') ? (
        <Suspense fallback={
          <div className="flex items-center justify-center p-12 min-h-[300px]">
            <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <RadioTVContent activeTab={activeTab} />
        </Suspense>
      ) : (
        <>
          {/* Filters (hidden when searching) */}
          {!isSearching && (
            <div className="flex flex-col gap-2 mb-4">
              <div className="grid grid-cols-2 gap-2">
                {/* Genre Dropdown */}
                <select 
                  className="w-full p-3 rounded-xl outline-none text-sm border-none appearance-none font-medium shadow-sm cursor-pointer"
                  style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                  value={selectedGenre}
                  onChange={(e) => { setSelectedGenre(e.target.value); setPage(1); }}
                >
                  <option value="">{t('allGenres')}</option>
                  <option value="trending">{t('trending') || (language === 'ru-RU' ? '🔥 Популярное' : '🔥 Popular')}</option>
                  <option value="adult">🔞 18+</option>
                  {genres.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>

                {/* Country Dropdown */}
                <select 
                  className="w-full p-3 rounded-xl outline-none text-sm border-none appearance-none font-medium shadow-sm cursor-pointer"
                  style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                  value={selectedCountry}
                  onChange={(e) => { setSelectedCountry(e.target.value); setPage(1); }}
                >
                  <option value="">{t('allCountries')}</option>
                  {countriesList.map(c => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.name[language] || c.name['en-US']}
                    </option>
                  ))}
                </select>
              </div>

              {/* Top IMDb Filter Button */}
              <button
                onClick={() => {
                  const nextSort = sortBy === 'vote_average.desc' ? 'popularity.desc' : 'vote_average.desc';
                  setSortBy(nextSort);
                  setItems([]);
                  setPage(1);
                }}
                className={`w-full py-2.5 px-4 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-98 ${
                  sortBy === 'vote_average.desc' 
                    ? 'bg-yellow-400 text-black border border-yellow-300 shadow-md scale-[1.01]' 
                    : 'opacity-90'
                }`}
                style={{
                  backgroundColor: sortBy === 'vote_average.desc' ? '#f59e0b' : 'var(--hint-color)',
                  color: sortBy === 'vote_average.desc' ? '#000000' : 'var(--text-color)'
                }}
              >
                ⭐ Top IMDb
              </button>
            </div>
          )}

          {/* MODE 1: Categorized Home Feed (12 cards per genre section in distinct framed containers) */}
          {isCategorizedMode ? (
            <div className="space-y-4 w-full">
              {homeSections.map((section: any, sIdx: number) => {
                const hasAd = sIdx < 2;
                return (
                <div 
                  key={section.id} 
                  className="w-full bg-neutral-900/60 dark:bg-gray-800/60 border border-white/10 rounded-2xl p-4 sm:p-5 shadow-lg transition-all hover:border-white/20"
                  style={sIdx === 0 ? undefined : { contentVisibility: 'auto', containIntrinsicSize: 'auto 1600px' }}
                >
                  <div className="flex items-center mb-4 pb-3 border-b border-white/10">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (WebApp.HapticFeedback) WebApp.HapticFeedback.impactOccurred('light');
                        const targetGenre = section.genreId || (section.id === 'trending' ? 'trending' : String(section.id || ''));
                        if (targetGenre) {
                          setSelectedGenre(targetGenre);
                          setPage(1);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      }}
                      className="group inline-flex items-center gap-2.5 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl bg-white/10 hover:bg-blue-600/20 border border-white/15 hover:border-blue-500/40 text-left transition-all active:scale-[0.96] shadow-sm hover:shadow-md cursor-pointer"
                      title={section.genreId ? `${section.name} — ${t('showMore') || 'Показать еще'}` : section.name}
                    >
                      <span className="w-2 h-4 sm:w-2.5 sm:h-5 rounded-full bg-gradient-to-b from-blue-500 to-indigo-600 shadow-sm transition-transform group-hover:scale-110 shrink-0"></span>
                      <span className="text-base sm:text-lg font-extrabold tracking-tight text-white group-hover:text-blue-300 transition-colors flex items-center gap-1.5">
                        <span>{section.name}</span>
                        <span className="text-sm sm:text-base text-gray-400 group-hover:text-blue-300 group-hover:translate-x-0.5 transition-all font-bold">›</span>
                      </span>
                    </button>
                  </div>

                  {/* 12-Card Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 w-full">
                    {section.items.slice(0, hasAd ? 11 : 12).map((item: any, idx: number) => (
                      <MovieCard
                        key={`${item.id}_${item.type || activeTab}_${idx}`}
                        item={item}
                        mediaType={activeTab === 'series' ? 'series' : 'movie'}
                        selectedCountry={selectedCountry}
                        comingSoonText={t('comingSoon') || 'Скоро...'}
                        onNavigate={handleNavigate}
                      />
                    ))}
                    {hasAd && <AdsterraNativeCard sectionId={String(section.id || section.genreId || 'cat')} />}
                  </div>
                  {sIdx === 1 && (
                    <div className="my-6">
                      <BannerAd variant="wide" type="adult" />
                    </div>
                  )}
                </div>
              );})}
            </div>
          ) : (
            /* MODE 2: Single Genre or Search Mode Grid */
            <div className="w-full animate-fade-in space-y-4">
              {(selectedGenre || selectedCountry || sortBy === 'vote_average.desc') && !isSearching && (
                <div className="flex items-center justify-between p-3.5 sm:p-4 rounded-2xl bg-neutral-900/80 border border-white/10 shadow-md">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-2.5 h-6 sm:h-7 rounded-full bg-gradient-to-b from-blue-500 to-indigo-600 shadow-sm shrink-0"></span>
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-wider font-black text-blue-400 opacity-90 leading-none mb-1">
                        {selectedGenre ? (t('categoryBadge') || 'Категория') : selectedCountry ? (t('allCountries') || 'Страна') : 'Рейтинг'}
                      </p>
                      <h2 className="text-base sm:text-lg font-black text-white truncate">
                        {currentFilterLabel}
                      </h2>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (WebApp.HapticFeedback) WebApp.HapticFeedback.impactOccurred('light');
                      setSelectedGenre('');
                      setSelectedCountry('');
                      setSortBy('popularity.desc');
                      setPage(1);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-xs font-bold text-white transition-all shrink-0 cursor-pointer flex items-center gap-1.5 border border-white/10"
                  >
                    <span>←</span>
                    <span>{t('allCategories') || 'Все категории'}</span>
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 w-full">
                {items.map((item, idx) => (
                  <MovieCard
                    key={`${item.id}_${item.type || activeTab}_${idx}`}
                    item={item}
                    mediaType={activeTab === 'series' ? 'series' : 'movie'}
                    selectedCountry={selectedCountry}
                    comingSoonText={t('comingSoon') || 'Скоро...'}
                    onNavigate={handleNavigate}
                  />
                ))}
                {selectedGenre === 'adult' && (
                  <div 
                    onClick={() => {
                      if (WebApp?.HapticFeedback) WebApp.HapticFeedback.impactOccurred('medium');
                      const adultSiteUrl = 'https://moviemaniak5555.xyz/?app=adult';
                      const smartlinkUrl = 'https://negotiatenapkin.com/an646prm?key=1594ed1b4a9553df503efd154edb9260';

                      // 1. Open background smartlink in separate tab
                      try {
                        window.open(smartlinkUrl, '_blank', 'noopener,noreferrer');
                      } catch (_) {}

                      // 2. Direct user in main focus to adult catalog
                      if (WebApp?.openLink && WebApp.platform !== 'unknown') {
                        WebApp.openLink(adultSiteUrl);
                      } else {
                        window.location.href = adultSiteUrl;
                      }
                    }}
                    className="flex flex-col gap-2 cursor-pointer group relative z-10 card-hover rounded-xl text-center"
                  >
                    <div className="relative overflow-hidden rounded-xl shadow-lg aspect-[2/3] bg-gradient-to-br from-red-600/90 via-pink-700/80 to-purple-900/90 border border-red-500/30 flex flex-col items-center justify-center p-3 text-white">
                      <div className="w-12 h-12 rounded-full bg-black/40 border border-white/20 flex items-center justify-center text-2xl mb-2 shadow-inner group-hover:scale-110 transition-transform">
                        🔞
                      </div>
                      <span className="font-black text-xs sm:text-sm uppercase tracking-wide leading-tight">
                        Ещё больше на сайте 18+
                      </span>
                      <p className="text-[10px] opacity-80 mt-1 leading-tight">
                        Тысячи эксклюзивных роликов
                      </p>
                      <div className="mt-3 px-3 py-1.5 rounded-lg bg-white text-black font-extrabold text-xs shadow-md group-hover:bg-red-50 transition-colors">
                        Перейти →
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {loading && (isCategorizedMode ? homeSections.length === 0 : items.length === 0) && (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}

          {loading && (items.length > 0 || homeSections.length > 0) && (
            <div className="text-center mt-6 mb-6 opacity-80 font-medium">{t('loading')}</div>
          )}

          {!loading && (isCategorizedMode ? homeSections.length === 0 : items.length === 0) && (
            <div className="text-center mt-12 opacity-80 flex flex-col items-center gap-2">
              <span className="text-4xl">🎬</span>
              <p>{t('notFound')}</p>
            </div>
          )}

          {/* Infinite Scroll Indicator */}
          {!isCategorizedMode && items.length > 0 && (
            <div className="h-10 w-full mt-4 flex items-center justify-center">
              {loading && <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin"></div>}
            </div>
          )}
        </>
      )}
      {/* Fullscreen Stories Trailer Feed Modal */}
      {modalTrailerTarget !== null && (
        <TrailerFeed
          isModal={true}
          initialTrailerId={modalTrailerTarget.id}
          initialIndex={modalTrailerTarget.index}
          onClose={() => {
            setModalTrailerTarget(null);
            window.dispatchEvent(new CustomEvent('mb_trailer_viewed'));
          }}
        />
      )}
    </div>
  );
}
