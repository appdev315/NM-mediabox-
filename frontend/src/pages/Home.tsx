import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, type Genre } from '../hooks/useApi';
import { clientCache } from '../utils/clientCache';
import { useLanguage, countriesList } from '../context/LanguageContext';
import { useAdManager } from '../context/AdManager';
import { Header } from '../components/Header';
import { ExoClickMainBanner } from '../components/ExoClickMainBanner';
import { RadioTVContent } from './RadioTV';
import { WebApp } from '../telegram';
import { useHomeState } from '../context/HomeStateContext';
import { triggerViewportExpand } from '../hooks/useViewportExpand';

export function Home() {
  const navigate = useNavigate();
  const { fetchMovies, fetchSeries, searchContent, fetchGenres, fetchCategorizedHome, loading } = useApi();
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
    searchQuery,
    setSearchQuery,
    isSearching,
    setIsSearching,
    scrollY,
    setScrollY
  } = useHomeState();

  const [genres, setGenres] = useState<Genre[]>([]);
  const [homeSections, setHomeSections] = useState<any[]>([]);
  const [sortBy, setSortBy] = useState<'popularity.desc' | 'vote_average.desc'>('popularity.desc');
  const [searchInput, setSearchInput] = useState<string>(searchQuery);
  const isFirstRender = useRef(true);
  const hasRestoredScrollRef = useRef(false);

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  // Synchronous initial restore from client cache for 0ms loading state on tab switch
  useEffect(() => {
    if (searchQuery.trim().length === 0 && !selectedGenre && !selectedCountry && sortBy === 'popularity.desc' && page === 1 && homeSections.length === 0) {
      const cacheKey = `categorized_home_v3_${activeTab === 'movie' ? 'movie' : 'tv'}_${language}`;
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
        if (searchQuery.trim().length > 0) {
          setIsSearching(true);
          const results = await searchContent(searchQuery);
          setItems(results);
        } else if (selectedGenre || selectedCountry || sortBy === 'vote_average.desc' || page > 1) {
          setIsSearching(false);
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
        } else {
          // Default categorized home feed (12 cards per genre section, cached for 24 hours)
          setIsSearching(false);
          const cacheKey = `categorized_home_v3_${activeTab === 'movie' ? 'movie' : 'tv'}_${language}`;
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
      if (loading || isSearching || (!selectedGenre && !selectedCountry && sortBy === 'popularity.desc' && !searchQuery)) return;
      
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
    setPage(1);
    setSelectedGenre('');
    setSelectedCountry('');
    setSearchQuery('');
    setItems([]);
    setHomeSections([]);
    setIsSearching(false);
    hasRestoredScrollRef.current = false;
    setScrollY(0);
    triggerAd();
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = searchInput.trim();
    setSearchQuery(trimmed);
    setPage(1);
  };

  const renderMovieCard = (item: any, idx?: number) => {
    if (!item || !item.id) return null;
    const mediaType = item.type || (activeTab === 'series' ? 'series' : 'movie');
    const cardKey = idx !== undefined ? `${item.id}_${mediaType}_${idx}` : `${item.id}_${mediaType}`;
    return (
      <div 
        key={cardKey}
        onClick={(e) => {
          e.stopPropagation();
          (document.activeElement as HTMLElement)?.blur();
          const countryQuery = selectedCountry ? `&country=${selectedCountry}` : '';
          navigate(`/movie/${item.id}?type=${mediaType}${countryQuery}`);
        }}
        className="flex flex-col gap-2 cursor-pointer group relative z-10 card-hover rounded-xl"
      >
      <div className="relative overflow-hidden rounded-xl shadow-sm aspect-[2/3] bg-[var(--hint-color)]">
        {item.isUpcoming && (
          <div className="absolute top-2 left-2 z-20">
            <span className="bg-amber-500/90 text-black text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md shadow-md backdrop-blur-sm flex items-center gap-1 border border-amber-400/40">
              ⏳ {(t as any)('comingSoon') || 'Скоро...'}
            </span>
          </div>
        )}
        <img 
          src={item.poster} 
          alt={item.title} 
          width={300}
          height={450}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="300" height="450" fill="%23242f3d"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23ffffff" font-size="18" font-family="sans-serif">No Poster</text></svg>';
          }}
        />

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
};

  const isCategorizedMode = !selectedGenre && !selectedCountry && sortBy === 'popularity.desc' && !isSearching && page === 1;

  return (
    <div 
      className="px-3 sm:px-4 pb-20"
      style={{ paddingTop: 'calc(6rem + env(safe-area-inset-top))' }}
    >
      {/* Header & Profile */}
      <Header />
      <ExoClickMainBanner />

      {/* Top Navigation */}
      <div className="flex gap-2 mb-6 bg-black/20 p-1 rounded-xl overflow-x-auto hide-scrollbar">
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
              color: activeTab === tab.id ? 'var(--button-text-color)' : 'var(--text-color)'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(activeTab === 'radio' || activeTab === 'tv') ? (
        <RadioTVContent activeTab={activeTab} />
      ) : (
        <>
          <form onSubmit={handleSearchSubmit} className="mb-4 flex gap-2 items-center">
            <input 
              type="text" 
              placeholder={t('searchPlaceholder')} 
              value={searchInput}
              onChange={(e) => {
                const val = e.target.value;
                setSearchInput(val);
                if (val === '') {
                  setSearchQuery('');
                  setPage(1);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                  handleSearchSubmit();
                } else if (e.key === 'Escape') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              onBlur={() => {
                requestAnimationFrame(() => {
                  window.scrollTo(0, 0);
                  triggerViewportExpand();
                });
              }}
              className="flex-1 p-3 rounded-xl outline-none font-medium border-none shadow-sm text-sm min-w-0"
              style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
            />
            <button
              type="submit"
              className="px-3.5 py-3 text-xs font-bold rounded-xl transition-all shadow-sm flex items-center justify-center gap-1 shrink-0 active:scale-95 cursor-pointer whitespace-nowrap"
              style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
            >
              🔍 {t('searchBtn')}
            </button>
          </form>

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
              {homeSections.map((section: any) => (
                <div key={section.id} className="w-full bg-white/5 dark:bg-gray-800/40 border border-white/10 dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-xl backdrop-blur-sm transition-all hover:border-white/20">
                  <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-indigo-600 shadow-md"></span>
                      <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">{section.name}</h2>
                    </div>
                    {section.genreId && (
                      <button
                        onClick={() => {
                          setSelectedGenre(section.genreId);
                          setPage(1);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="text-xs sm:text-sm font-extrabold px-3.5 py-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
                      >
                        {t('showMore') || 'Показать еще'} ➔
                      </button>
                    )}
                  </div>

                  {/* 12-Card Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 w-full">
                    {section.items.map((item: any, idx: number) => renderMovieCard(item, idx))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* MODE 2: Single Genre or Search Mode Grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 w-full animate-fade-in">
              {items.map((item, idx) => renderMovieCard(item, idx))}
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
    </div>
  );
}
