import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebApp } from '../telegram';
import { API_BASE } from '../hooks/useApi';
import { useLanguage } from '../context/LanguageContext';
import { Header } from '../components/Header';
import { BannerAd } from '../components/BannerAd';
import React from 'react';
import ExoClickNativeAd from '../components/ExoClickNativeAd';
import { ExoClickBanner18 } from '../components/ExoClickBanner18';

import { shouldShowAd } from '../utils/adPlacement';

const CATEGORIES = [
  { id: '', label: 'All / Random' },
  { id: 'milf', label: 'MILF' },
  { id: 'teen', label: 'Teens' },
  { id: 'japanese', label: 'Japanese' },
  { id: 'latina', label: 'Latina' },
  { id: 'amateur', label: 'Amateur' },
  { id: 'lesbian', label: 'Lesbian' },
  { id: 'massage', label: 'Massage' },
  { id: 'ebony', label: 'Ebony' },
  { id: 'bbw', label: 'BBW' },
  { id: 'threesome', label: 'Threesome' },
  { id: 'pov', label: 'POV' },
  { id: 'hentai', label: 'Hentai' },
  { id: 'russian', label: 'Russian' },
  { id: 'asian', label: 'Asian' },
  { id: 'babe', label: 'Babe' },
  { id: 'anal', label: 'Anal' },
  { id: 'blonde', label: 'Blonde' },
  { id: 'brunette', label: 'Brunette' },
  { id: 'creampie', label: 'Creampie' },
  { id: 'cuckold', label: 'Cuckold' },
  { id: 'group', label: 'Group' },
  { id: 'mature', label: 'Mature' },
  { id: 'public', label: 'Public' },
  { id: 'school', label: 'School' },
  { id: 'stepmom', label: 'Step Mom' },
  { id: 'stepsister', label: 'Step Sister' },
  { id: 'toys', label: 'Toys' }
];

export function Adult() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  
  // Start with a random category initially
  const [category, setCategory] = useState(() => {
    const randomIndex = 1 + Math.floor(Math.random() * (CATEGORIES.length - 1));
    return CATEGORIES[randomIndex].id;
  });
  const [page, setPage] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  const hasAccess = true;

  const [ageConfirmed, setAgeConfirmed] = useState(true);
  
  const [favorites, setFavorites] = useState<any[]>([]);
  

  useEffect(() => {
    
    const savedFavs = localStorage.getItem('private_favs');
    if (savedFavs) {
      try { setFavorites(JSON.parse(savedFavs)); } catch(e){}
    }


    // Check if age was already confirmed
    const confirmed = localStorage.getItem('age_confirmed') === 'true';
    if (confirmed) setAgeConfirmed(true);
    
    if (hasAccess && (ageConfirmed || confirmed)) {
      // Use the randomly initialized category instead of hardcoded 'teen'
      loadVideos(category, 0);
    } else {
      setLoading(false);
    }
  }, [hasAccess]);

  const loadVideos = async (searchQuery: string, pageNum: number = 0, append: boolean = false) => {
    if (append) {
      setIsLoadingMore(true);
    } else {
      setLoading(true);
    }
    
    try {
      const initData = WebApp?.initData || '';
      const headers = { 'Authorization': `tma ${initData}` };
      const res = await fetch(`${API_BASE}/adult/search?q=${encodeURIComponent(searchQuery)}&page=${pageNum}`, { headers });
      const data = await res.json();
      if (Array.isArray(data)) {
        // Shuffle the array so even the same page feels different
        const shuffled = data.sort(() => 0.5 - Math.random());
        if (append) {
          setVideos(prev => {
            // Filter out duplicates
            const existingIds = new Set(prev.map(v => v.id));
            const newVideos = shuffled.filter(v => !existingIds.has(v.id));
            return [...prev, ...newVideos];
          });
        } else {
          setVideos(shuffled);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  const loadMore = useCallback(() => {
    if (loading || isLoadingMore || !hasAccess || !ageConfirmed) return;
    
    if (category === '' && query === '') {
      // Infinite mode
      const randomCat = CATEGORIES[1 + Math.floor(Math.random() * (CATEGORIES.length - 1))].id;
      const nextPage = page + 1;
      setPage(nextPage);
      loadVideos(randomCat, nextPage, true);
    } else {
      // Specific search/category mode
      const nextPage = page + 1;
      setPage(nextPage);
      loadVideos(query || category, nextPage, true);
    }
  }, [loading, isLoadingMore, hasAccess, ageConfirmed, category, query, page]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      
      if (scrollY + windowHeight >= documentHeight - 100) {
        loadMore();
      }
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loadMore]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasAccess) {
      setPage(0);
      loadVideos(query || category, 0, false);
    }
  };

  const toggleFavorite = (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    setFavorites(prev => {
      const isFav = prev.some(f => f.id === item.id);
      const newFavs = isFav ? prev.filter(f => f.id !== item.id) : [...prev, item];
      localStorage.setItem('private_favs', JSON.stringify(newFavs));
      return newFavs;
    });
  };



  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setCategory(val);
    setQuery('');
    setPage(0);
    if (hasAccess) {
      if (val === '') {
        const randomCat = CATEGORIES[1 + Math.floor(Math.random() * (CATEGORIES.length - 1))].id;
        const randomPage = Math.floor(Math.random() * 10);
        loadVideos(randomCat, randomPage, false);
      } else {
        loadVideos(val, 0, false);
      }
    }
  };





  if (hasAccess && !ageConfirmed) {
    return (
      <div className="p-6 pt-20 flex flex-col items-center justify-center text-center min-h-[70vh]">
        <div className="text-6xl mb-6">🔞</div>
        <h1 className="text-2xl font-bold mb-4">🔞</h1>
        <div className="opacity-70 mb-8 leading-relaxed text-sm text-left bg-black/10 p-4 rounded-xl border border-white/10 shadow-inner flex flex-col gap-3">
          <p>
            <strong>{t('secretRoomRulesTitle')}</strong><br/>
            {t('secretRoomRule1')}<br/>
            {t('secretRoomRule2')}<br/>
            {t('secretRoomRule3')}
          </p>
          <p>
            {t('secretRoomWarning')}
          </p>
        </div>
        
        <div className="w-full flex flex-col gap-3">
          <button 
            onClick={() => {
              WebApp.HapticFeedback.impactOccurred('heavy');
              setAgeConfirmed(true);
              localStorage.setItem('age_confirmed', 'true');
              setPage(0);
              loadVideos(category, 0);
            }}
            className="w-full py-4 rounded-2xl font-bold text-lg active:scale-95 transition-transform"
            style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
          >
            {t('secretRoomConfirm')}
          </button>
          
          <button 
            onClick={() => {
              WebApp.HapticFeedback.notificationOccurred('error');
              navigate(-1);
            }}
            className="w-full py-4 rounded-2xl font-bold text-lg active:scale-95 transition-transform bg-transparent border-2"
            style={{ borderColor: 'var(--hint-color)', color: 'var(--text-color)' }}
          >
            {t('secretRoomLeave')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 sm:px-4 pb-20 pt-24 sm:pt-24">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-extrabold">{t('privateCollection')} 🍓</h1>
      </div>
      
      <div className="flex gap-2 mb-6">
        <select 
          className="flex-1 p-3 rounded-2xl outline-none text-sm border-none appearance-none font-medium shadow-sm"
          style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
          value={category}
          onChange={handleCategoryChange}
        >
          {CATEGORIES.map(c => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSearch} className="mb-6 relative">
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full p-4 rounded-2xl outline-none font-medium shadow-sm transition-shadow focus:shadow-md"
          style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
        />
      </form>

      {loading && !isLoadingMore ? (
        <div className="flex justify-center py-20 opacity-50 font-medium">Loading...</div>
      ) : (
        <>
          <ExoClickBanner18 />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 w-[90%] mx-auto">
            {videos.map((v, idx) => (
              <React.Fragment key={v.id}>
              <div 
                className="cursor-pointer active:scale-95 transition-transform"
                onClick={() => navigate(`/adult/${v.id}`, { state: { category: query || category } })}
              >
                <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-2 relative shadow-sm">
                  <img src={v.poster} className="w-full h-full object-cover" alt="" />
                  <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                    {v.duration}
                  </div>
                  <button 
                    onClick={(e) => toggleFavorite(e, v)}
                    className="absolute top-2 right-2 p-2 bg-black/50 backdrop-blur-md rounded-full hover:scale-110 transition-transform shadow-md"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill={favorites.some(f => f.id === v.id) ? "#fbbf24" : "transparent"} stroke={favorites.some(f => f.id === v.id) ? "#fbbf24" : "white"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                </div>
                <p className="text-sm font-semibold line-clamp-2 leading-snug">{v.title}</p>
              </div>
              {(idx + 1) % 15 === 0 && <BannerAd type={(idx + 1) % 30 === 0 ? "mainbot" : "telegram"} />}
              {(idx + 1) % 12 === 0 && <ExoClickNativeAd className="exo-native-ad-container" />}
              </React.Fragment>
            ))}
          </div>
          {isLoadingMore && (
            <div className="flex justify-center mt-6">
              <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
        </>
      )}
      <Header />
    </div>
  );
}
