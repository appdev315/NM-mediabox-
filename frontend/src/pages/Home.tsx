import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApi, type Genre } from '../hooks/useApi';
import { useLanguage } from '../context/LanguageContext';
import { useAdManager } from '../context/AdManager';


import { Header } from '../components/Header';
import { BannerAd } from '../components/BannerAd';
import { ExoClickMainBanner } from '../components/ExoClickMainBanner';
import { RadioTVContent } from './RadioTV';
import ExoClickWhiteAd from '../components/ExoClickWhiteAd';
import { WebApp } from '../telegram';
import { shouldShowAd } from '../utils/adPlacement';

export function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const { fetchTrending, fetchMovies, fetchSeries, searchContent, fetchGenres, loading } = useApi();
  const { language, t } = useLanguage();
  const { triggerAd } = useAdManager();

  
  const [activeTab, setActiveTab] = useState<'movie' | 'series' | 'radio' | 'tv'>(
    (location.state as any)?.tab || 'movie'
  );
  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Load genres when tab or language changes
  useEffect(() => {
    const loadGenres = async () => {
      const g = await fetchGenres(activeTab === 'movie' ? 'movie' : 'tv');
      setGenres(g);
    };
    if (!isSearching) {
      loadGenres();
    }
  }, [activeTab, fetchGenres, isSearching, language]);



  // Load content
  useEffect(() => {
    const loadContent = async () => {
      try {
        if (searchQuery.trim().length > 0) {
          setIsSearching(true);
          const results = await searchContent(searchQuery);
          setItems(results.filter((r: any) => r.type === (activeTab === 'movie' ? 'movie' : 'series')));
        } else {
          setIsSearching(false);
          let results;
          
          // Initial load for popular content
          if (!selectedGenre && page === 1) {
            results = await fetchTrending(activeTab === 'movie' ? 'movie' : 'tv');
          } else {
            results = activeTab === 'movie' 
              ? await fetchMovies(page, selectedGenre)
              : await fetchSeries(page, selectedGenre);
          }
            
          if (page === 1) {
            setItems(results || []);
          } else {
            setItems(prev => [...prev, ...(results || [])]);
          }
        }
      } catch (err) {
        console.error("Failed to load content:", err);
      }
    };

    const timeoutId = setTimeout(loadContent, 500);
    return () => clearTimeout(timeoutId);
  }, [activeTab, page, selectedGenre, searchQuery, fetchTrending, fetchMovies, fetchSeries, searchContent, language]);

  // Infinite scroll listener
  useEffect(() => {
    const handleScroll = () => {
      if (loading || isSearching) return;
      
      const scrollY = window.scrollY;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      
      // If user has scrolled to within 100px of the bottom
      if (scrollY + windowHeight >= documentHeight - 100) {
        setPage(p => p + 1);
      }
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loading, isSearching, page]);

  const handleTabChange = (tab: 'movie' | 'series' | 'radio' | 'tv') => {
    setActiveTab(tab);
    setPage(1);
    setSelectedGenre('');
    setSearchQuery('');
    setItems([]);
    setIsSearching(false);
    triggerAd();
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(1);
  };

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
              className="w-full p-3 rounded-xl outline-none font-medium border-none shadow-sm"
              style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
            />
          </div>

          {/* Filters (hidden when searching) */}
          {!isSearching && (
            <div className="flex gap-3 mb-6">
              <select 
                className="flex-1 p-3 rounded-xl outline-none text-sm border-none appearance-none font-medium shadow-sm"
                style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
                value={selectedGenre}
                onChange={(e) => { setSelectedGenre(e.target.value); setPage(1); }}
              >
                <option value="">{t('allGenres')}</option>
                {genres.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Content Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 w-[90%] mx-auto animate-fade-in">
            {items.map((item, idx) => (
              <React.Fragment key={`${item.id}-${idx}`}>
                <div 
                  onClick={() => navigate(`/movie/${item.id}?type=${item.type}`)}
                  className="flex flex-col gap-2 cursor-pointer group relative z-10 card-hover rounded-xl"
                >
            <div className="relative overflow-hidden rounded-xl shadow-sm aspect-[2/3] bg-[var(--hint-color)]">
                  <img 
                    src={item.poster} 
                    alt={item.title} 
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 will-change-transform"
                    loading="lazy"
                  />
                  {/* Subtle Gradient Overlay on Hover for depth */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                </div>
                <div className="mt-1 px-1">
                  <h3 className="font-bold text-sm leading-tight line-clamp-1">{item.title}</h3>
                  <p className="text-xs opacity-70 mt-1 font-medium">{item.year}</p>
                </div>
              </div>
              {(idx + 1) % 15 === 0 && <BannerAd type={(idx + 1) % 30 === 0 ? "mainbot" : "telegram"} />}
              {shouldShowAd(idx) && <ExoClickWhiteAd className="exo-banner-movie-card w-full rounded-xl overflow-hidden" />}
              </React.Fragment>
            ))}
          </div>
          
          {loading && <div className="text-center mt-6 mb-6 opacity-80 font-medium">{t('loading')}</div>}

          {!loading && items.length === 0 && (
            <div className="text-center mt-12 opacity-80 flex flex-col items-center gap-2">
              <span className="text-4xl">🎬</span>
              <p>{t('notFound')}</p>
            </div>
          )}

          {/* Infinite Scroll Indicator */}
          {!isSearching && items.length > 0 && (
            <div className="h-10 w-full mt-4 flex items-center justify-center">
              {loading && <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin"></div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
