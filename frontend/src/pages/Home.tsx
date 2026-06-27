import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, type Genre } from '../hooks/useApi';
import { useLanguage } from '../context/LanguageContext';
import { useVip } from '../context/VipContext';
import { Downloads } from '../components/Downloads';
import { Header } from '../components/Header';

export function Home() {
  const navigate = useNavigate();
  const { fetchTrending, fetchMovies, fetchSeries, searchContent, fetchGenres, loading } = useApi();
  const { language, t } = useLanguage();
  const { isVip, showVipModal, config } = useVip();
  const showPrivate = localStorage.getItem('showPrivate') !== 'false';
  
  const [activeTab, setActiveTab] = useState<'movie' | 'series' | 'downloads' | 'private'>('movie');
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

  useEffect(() => {
    if (language !== 'ru-RU' && activeTab === 'downloads') {
      setActiveTab('movie');
      setPage(1);
    }
  }, [language, activeTab]);

  // Load content
  useEffect(() => {
    const loadContent = async () => {
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
          setItems(results);
        } else {
          setItems(prev => [...prev, ...results]);
        }
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
  }, [loading, isSearching, isVip, config, page]);

  const handleTabChange = (tab: 'movie' | 'series' | 'downloads') => {
    setActiveTab(tab);
    setPage(1);
    setSelectedGenre('');
    setSearchQuery('');
    setItems([]);
    setIsSearching(false);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setPage(1);
  };

  return (
    <div className="p-4 pb-20">
      {/* Header & Profile */}
      <Header />

      {/* Top Navigation */}
      <div className="flex gap-2 mb-6 bg-black/20 p-1 rounded-xl overflow-x-auto hide-scrollbar">
        {[
          { id: 'movie', label: t('movies') },
          { id: 'series', label: t('series') },
          { id: 'radio-tv', label: t('radio_and_tv') },
          ...(language === 'ru-RU' ? [{ id: 'downloads', label: t('downloadsTab') }] : []),
          ...(showPrivate ? [{ id: 'private', label: 'Private 💎' }] : [])
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              if (tab.id === 'private') {
                navigate('/adult');
              }
              else if (tab.id === 'radio-tv') {
                navigate('/radio-tv');
              }
              else handleTabChange(tab.id as 'movie' | 'series' | 'downloads');
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

      {/* Search Input */}
      {activeTab !== 'downloads' && (
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
      )}

      {/* Filters (hidden when searching) */}
      {!isSearching && activeTab !== 'downloads' && (
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
      {activeTab === 'downloads' ? (
        <Downloads />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4">
            {items.map((item, idx) => (
              <div 
                key={`${item.id}-${idx}`} 
                onClick={() => navigate(`/movie/${item.id}?type=${item.type}`)}
                className="flex flex-col gap-2 cursor-pointer group"
              >
            <div className="relative overflow-hidden rounded-xl shadow-lg transition-transform duration-300 group-hover:shadow-2xl">
                  <img 
                    src={item.poster} 
                    alt={item.title} 
                    className="w-full aspect-[2/3] object-cover"
                  />
                </div>
                <div className="mt-1">
                  <h3 className="font-bold text-sm leading-tight line-clamp-1">{item.title}</h3>
                  <p className="text-xs opacity-90 mt-1">{item.year}</p>
                </div>
              </div>
            ))}
          </div>
          
          {loading && <div className="text-center mt-6 mb-6 opacity-80 font-medium">{t('loading')}</div>}

          {!loading && items.length === 0 && (
            <div className="text-center mt-12 opacity-80 flex flex-col items-center gap-2">
              <span className="text-4xl">🎬</span>
              <p>{t('notFound')}</p>
            </div>
          )}

          {/* Infinite Scroll Indicator or VIP Banner */}
          {!isSearching && items.length > 0 && (
            isVip ? (
              <div className="h-10 w-full mt-4 flex items-center justify-center">
                {loading && <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin"></div>}
              </div>
            ) : (
              config?.freeLimits && (
                <div className="w-full max-w-md mx-auto mt-8 bg-black/10 dark:bg-white/5 rounded-3xl p-6 text-center border" style={{ borderColor: 'var(--hint-color)' }}>
                  <h3 className="font-bold text-lg mb-2" style={{ color: 'var(--text-color)' }}>Хотите смотреть больше? 💎</h3>
                  <p className="text-sm opacity-70 mb-4" style={{ color: 'var(--text-color)' }}>Бесплатно доступны только первые фильмы. Поддержите создателя, чтобы открыть полную библиотеку без ограничений!</p>
                  <button 
                    onClick={showVipModal}
                    className="px-6 py-3 rounded-xl font-bold transition-transform active:scale-95 bg-blue-500 hover:bg-blue-600 text-white"
                  >
                    ⭐️ Разблокировать всё за {config?.priceMonth || 75} ⭐️
                  </button>
                </div>
              )
            )
          )}
        </>
      )}
    </div>
  );
}
