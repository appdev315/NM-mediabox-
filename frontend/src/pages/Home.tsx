import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, type Genre } from '../hooks/useApi';
import { useLanguage } from '../context/LanguageContext';

export function Home() {
  const navigate = useNavigate();
  const { fetchTrendingMovies, fetchMovies, fetchSeries, searchContent, fetchGenres, loading } = useApi();
  const { language, setLanguage, t } = useLanguage();
  
  const [activeTab, setActiveTab] = useState<'movie' | 'series'>('movie');
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
      if (searchQuery.trim().length > 0) {
        setIsSearching(true);
        const results = await searchContent(searchQuery);
        setItems(results);
      } else {
        setIsSearching(false);
        let results;
        
        // Initial load for popular movies
        if (!selectedGenre && activeTab === 'movie' && page === 1) {
          results = await fetchTrendingMovies();
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
  }, [activeTab, page, selectedGenre, searchQuery, fetchTrendingMovies, fetchMovies, fetchSeries, searchContent, language]);

  const handleTabChange = (tab: 'movie' | 'series') => {
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
      {/* Header & Language Switcher */}
      <div className="flex justify-between items-center mb-6 mt-2">
        <h1 className="text-2xl font-extrabold tracking-tight">NM Movie</h1>
        <button 
          onClick={() => setLanguage(language === 'ru-RU' ? 'en-US' : 'ru-RU')}
          className="px-4 py-2 text-sm font-bold rounded-xl transition-transform active:scale-95 shadow-sm"
          style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
        >
          {language === 'ru-RU' ? 'RU' : 'EN'}
        </button>
      </div>

      {/* Top Navigation */}
      <div className="flex gap-2 mb-6 bg-black/20 p-1 rounded-xl">
        {[
          { id: 'movie', label: t('movies') },
          { id: 'series', label: t('series') },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id as 'movie' | 'series')}
            className="flex-1 py-2 text-sm font-bold rounded-lg transition-colors"
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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {items.map((item, idx) => (
          <div 
            key={`${item.id}-${idx}`} 
            onClick={() => navigate(`/movie/${item.id}?type=${item.type}`)}
            className="flex flex-col gap-2 cursor-pointer active:scale-95 transition-transform"
          >
            <img 
              src={item.poster} 
              alt={item.title} 
              className="w-full aspect-[2/3] object-cover rounded-xl shadow-md"
            />
            <div>
              <h3 className="font-bold text-sm leading-tight line-clamp-1">{item.title}</h3>
              <p className="text-xs opacity-60 mt-1">{item.year}</p>
            </div>
          </div>
        ))}
      </div>
      
      {loading && <div className="text-center mt-6 mb-6 opacity-50 font-medium">{t('loading')}</div>}

      {!loading && items.length === 0 && (
        <div className="text-center mt-12 opacity-50 flex flex-col items-center gap-2">
          <span className="text-4xl">🎬</span>
          <p>{t('notFound')}</p>
        </div>
      )}

      {/* Load More Button */}
      {!isSearching && items.length > 0 && !loading && (
        <button
          onClick={() => setPage(p => p + 1)}
          className="w-full mt-6 p-4 rounded-xl font-bold transition-transform active:scale-95 shadow-md flex items-center justify-center gap-2"
          style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
        >
          {t('loadMore')}
        </button>
      )}
    </div>
  );
}
