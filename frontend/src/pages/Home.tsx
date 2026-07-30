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
  const isFirstRender = useRef(true);

  // Synchronous initial restore from client cache for 0ms loading state on tab switch
  useEffect(() => {
    if (searchQuery.trim().length === 0 && !selectedGenre && !selectedCountry && page === 1 && homeSections.length === 0) {
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

  useEffect(() => {
    const loadGenres = async () => {
      if (activeTab === 'movie' || activeTab === 'series') {
        const type = activeTab === 'movie' ? 'movie' : 'tv';
        const data = await fetchGenres(type);
        setGenres(data);
      }
    };
    loadGenres();
  }, [activeTab, fetchGenres]);

  // Restore scroll position when items are loaded
  useEffect(() => {
    if ((items.length > 0 || homeSections.length > 0) && scrollY > 0) {
      const timer = setTimeout(() => {
        window.scrollTo(0, scrollY);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [items.length, homeSections.length]);

  // Save scroll position when unmounting
  useEffect(() => {
    return () => {
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
        } else if (selectedGenre || selectedCountry || page > 1) {
          setIsSearching(false);
          const results = activeTab === 'movie' 
            ? await fetchMovies(page, selectedGenre, selectedCountry)
            : await fetchSeries(page, selectedGenre, selectedCountry);
            
          if (page === 1) {
            setItems(results || []);
          } else {
            setItems(prev => [...prev, ...(results || [])]);
          }
        } else {
          // Default categorized home feed (12 cards per genre section, cached for 24 hours)
          setIsSearching(false);
          const cacheKey = `categorized_home_v2_${activeTab === 'movie' ? 'movie' : 'tv'}_${language}`;
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
  }, [activeTab, page, selectedGenre, selectedCountry, searchQuery, fetchMovies, fetchSeries, searchContent, fetchCategorizedHome, language]);

  // Infinite scroll listener (only active when in single-genre, country, or search mode)
  useEffect(() => {
    const handleScroll = () => {
      if (loading || isSearching || (!selectedGenre && !selectedCountry && !searchQuery)) return;
      
      const scrollYPos = window.scrollY;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      
      if (scrollYPos + windowHeight >= documentHeight - 100) {
        setPage(p => p + 1);
      }
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loading, isSearching, page, selectedGenre, selectedCountry, searchQuery]);

  // Tablet & Mobile virtual keyboard geometry reset effect
  useEffect(() => {
    const handleViewportResize = () => {
      if (window.visualViewport) {
        if (window.visualViewport.height >= window.innerHeight * 0.85) {
          window.scrollTo(0, window.scrollY);
          try { WebApp.expand(); } catch (_) {}
        }
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
    }
    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportResize);
      }
    };
  }, []);

  const handleTabChange = (tab: 'movie' | 'series' | 'radio' | 'tv') => {
    (document.activeElement as HTMLElement)?.blur();
    setActiveTab(tab);
    setPage(1);
    setSelectedGenre('');
    setSearchQuery('');
    setItems([]);
    setHomeSections([]);
    setIsSearching(false);
    triggerAd();
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(1);
  };

  const renderMovieCard = (item: any) => (
    <div 
      key={item.id}
      onClick={() => {
        (document.activeElement as HTMLElement)?.blur();
        navigate(`/movie/${item.id}?type=${item.type}`);
      }}
      className="flex flex-col gap-2 cursor-pointer group relative z-10 card-hover rounded-xl"
    >
      <div className="relative overflow-hidden rounded-xl shadow-sm aspect-[2/3] bg-[var(--hint-color)]">
        <img 
          src={item.poster} 
          alt={item.title} 
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = 'https://placehold.co/300x450/242f3d/ffffff?text=No+Poster';
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

  const isCategorizedMode = !selectedGenre && !selectedCountry && !isSearching && page === 1;

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
          <div className="mb-4">
            <input 
              type="text" 
              placeholder={t('searchPlaceholder')} 
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-full p-3 rounded-xl outline-none font-medium border-none shadow-sm"
              style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
            />
          </div>

          {/* Filters (hidden when searching) */}
          {!isSearching && (
            <div className="grid grid-cols-2 gap-2 mb-4">
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

              {/* Country Dropdown (Placed directly below Genres) */}
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
          )}

          {/* MODE 1: Categorized Home Feed (12 cards per genre section with inter-section ads) */}
          {isCategorizedMode ? (
            <div className="space-y-5 w-full">
              {homeSections.map((section: any) => (
                <div key={section.id} className="w-full">
                  <div className="flex justify-between items-center mb-3 px-1">
                    <h2 className="text-lg sm:text-xl font-bold tracking-tight">{section.name}</h2>
                    {section.genreId && (
                      <button
                        onClick={() => {
                          setSelectedGenre(section.genreId);
                          setPage(1);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="text-xs sm:text-sm font-bold text-[var(--button-color)] hover:opacity-80 transition-opacity flex items-center gap-1 bg-black/10 dark:bg-white/10 px-3 py-1.5 rounded-lg"
                      >
                        {t('showMore') || 'Показать еще'} →
                      </button>
                    )}
                  </div>

                  {/* 12-Card Grid (Grid cols 2 / 3 / 4 / 6 align perfectly with 12 cards) */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 w-full">
                    {section.items.map((item: any) => renderMovieCard(item))}
                  </div>

                  {/* Inter-Section Ad Banner (Duplicating the top working ExoClickMainBanner format) */}
                  <div className="w-full my-6 flex justify-center">
                    <ExoClickMainBanner />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* MODE 2: Single Genre or Search Mode Grid */
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 w-full animate-fade-in">
              {items.map((item) => renderMovieCard(item))}
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
