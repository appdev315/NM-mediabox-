import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebApp } from '../telegram';
import { useApi } from '../hooks/useApi';
import { useLanguage } from '../context/LanguageContext';
import { Header } from '../components/Header';
import { BannerAd } from '../components/BannerAd';
import React from 'react';
import ExoClickNativeAd from '../components/ExoClickNativeAd';
import { ExoClickBanner18 } from '../components/ExoClickBanner18';
import { triggerViewportExpand } from '../hooks/useViewportExpand';



const CATEGORIES = [
  { id: '', label: 'All Categories / Все категории' },
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

const ADULT_COUNTRIES = [
  { id: '', labelRu: 'Все страны 🌐', labelEn: 'All Countries 🌐' },
  { id: 'australian', labelRu: '🇦🇺 Австралия', labelEn: '🇦🇺 Australia' },
  { id: 'austrian', labelRu: '🇦🇹 Австрия', labelEn: '🇦🇹 Austria' },
  { id: 'azerbaijan', labelRu: '🇦🇿 Азербайджан', labelEn: '🇦🇿 Azerbaijan' },
  { id: 'argentina', labelRu: '🇦🇷 Аргентина', labelEn: '🇦🇷 Argentina' },
  { id: 'afghanistan', labelRu: '🇦🇫 Афганистан', labelEn: '🇦🇫 Afghanistan' },
  { id: 'bangladesh', labelRu: '🇧🇩 Бангладеш', labelEn: '🇧🇩 Bangladesh' },
  { id: 'belgian', labelRu: '🇧🇪 Бельгия', labelEn: '🇧🇪 Belgium' },
  { id: 'bulgarian', labelRu: '🇧🇬 Болгария', labelEn: '🇧🇬 Bulgaria' },
  { id: 'bolivia', labelRu: '🇧🇴 Боливия', labelEn: '🇧🇴 Bolivia' },
  { id: 'brazilian', labelRu: '🇧🇷 Бразилия', labelEn: '🇧🇷 Brazil' },
  { id: 'british', labelRu: '🇬🇧 Великобритания', labelEn: '🇬🇧 United Kingdom' },
  { id: 'hungarian', labelRu: '🇭🇺 Венгрия', labelEn: '🇭🇺 Hungary' },
  { id: 'venezuela', labelRu: '🇻🇪 Венесуэла', labelEn: '🇻🇪 Venezuela' },
  { id: 'vietnamese', labelRu: '🇻🇳 Вьетнам', labelEn: '🇻🇳 Vietnam' },
  { id: 'guatemala', labelRu: '🇬🇹 Гватемала', labelEn: '🇬🇹 Guatemala' },
  { id: 'german', labelRu: '🇩🇪 Германия', labelEn: '🇩🇪 Germany' },
  { id: 'hong kong', labelRu: '🇭🇰 Гонконг', labelEn: '🇭🇰 Hong Kong' },
  { id: 'greek', labelRu: '🇬🇷 Греция', labelEn: '🇬🇷 Greece' },
  { id: 'georgian', labelRu: '🇬🇪 Грузия', labelEn: '🇬🇪 Georgia' },
  { id: 'danish', labelRu: '🇩🇰 Дания', labelEn: '🇩🇰 Denmark' },
  { id: 'dominican', labelRu: '🇩🇴 Доминиканская Республика', labelEn: '🇩🇴 Dominican Republic' },
  { id: 'egyptian', labelRu: '🇪🇬 Египет', labelEn: '🇪🇬 Egypt' },
  { id: 'israeli', labelRu: '🇮🇱 Израиль', labelEn: '🇮🇱 Israel' },
  { id: 'indian', labelRu: '🇮🇳 Индия', labelEn: '🇮🇳 India' },
  { id: 'indonesian', labelRu: '🇮🇩 Индонезия', labelEn: '🇮🇩 Indonesia' },
  { id: 'jordan', labelRu: '🇯🇴 Иордания', labelEn: '🇯🇴 Jordan' },
  { id: 'iraq', labelRu: '🇮🇶 Ирак', labelEn: '🇮🇶 Iraq' },
  { id: 'irish', labelRu: '🇮🇪 Ирландия', labelEn: '🇮🇪 Ireland' },
  { id: 'iceland', labelRu: '🇮🇸 Исландия', labelEn: '🇮🇸 Iceland' },
  { id: 'spanish', labelRu: '🇪🇸 Испания', labelEn: '🇪🇸 Spain' },
  { id: 'italian', labelRu: '🇮🇹 Италия', labelEn: '🇮🇹 Italy' },
  { id: 'cambodia', labelRu: '🇰🇭 Камбоджа', labelEn: '🇰🇭 Cambodia' },
  { id: 'cameroon', labelRu: '🇨🇲 Камерун', labelEn: '🇨🇲 Cameroon' },
  { id: 'canadian', labelRu: '🇨🇦 Канада', labelEn: '🇨🇦 Canada' },
  { id: 'qatar', labelRu: '🇶🇦 Катар', labelEn: '🇶🇦 Qatar' },
  { id: 'kenya', labelRu: '🇰🇪 Кения', labelEn: '🇰🇪 Kenya' },
  { id: 'cyprus', labelRu: '🇨🇾 Кипр', labelEn: '🇨🇾 Cyprus' },
  { id: 'chinese', labelRu: '🇨🇳 Китай', labelEn: '🇨🇳 China' },
  { id: 'colombian', labelRu: '🇨🇴 Колумбия', labelEn: '🇨🇴 Colombia' },
  { id: 'laos', labelRu: '🇱🇦 Лаос', labelEn: '🇱🇦 Laos' },
  { id: 'latvian', labelRu: '🇱🇻 Латвия', labelEn: '🇱🇻 Latvia' },
  { id: 'lebanon', labelRu: '🇱🇧 Ливан', labelEn: '🇱🇧 Lebanon' },
  { id: 'malaysian', labelRu: '🇲🇾 Малайзия', labelEn: '🇲🇾 Malaysia' },
  { id: 'malta', labelRu: '🇲🇹 Мальта', labelEn: '🇲🇹 Malta' },
  { id: 'moroccan', labelRu: '🇲🇦 Марокко', labelEn: '🇲🇦 Morocco' },
  { id: 'mexican', labelRu: '🇲🇽 Мексика', labelEn: '🇲🇽 Mexico' },
  { id: 'moldova', labelRu: '🇲🇩 Молдова', labelEn: '🇲🇩 Moldova' },
  { id: 'myanmar', labelRu: '🇲🇲 Мьянма', labelEn: '🇲🇲 Myanmar' },
  { id: 'nigerian', labelRu: '🇳🇬 Нигерия', labelEn: '🇳🇬 Nigeria' },
  { id: 'dutch', labelRu: '🇳🇱 Нидерланды', labelEn: '🇳🇱 Netherlands' },
  { id: 'new zealand', labelRu: '🇳🇿 Новая Зеландия', labelEn: '🇳🇿 New Zealand' },
  { id: 'norwegian', labelRu: '🇳🇴 Норвегия', labelEn: '🇳🇴 Norway' },
  { id: 'pakistani', labelRu: '🇵🇰 Пакистан', labelEn: '🇵🇰 Pakistan' },
  { id: 'peruvian', labelRu: '🇵🇪 Перу', labelEn: '🇵🇪 Peru' },
  { id: 'polish', labelRu: '🇵🇱 Польша', labelEn: '🇵🇱 Poland' },
  { id: 'portuguese', labelRu: '🇵🇹 Португалия', labelEn: '🇵🇹 Portugal' },
  { id: 'korean', labelRu: '🇰🇷 Республика Корея', labelEn: '🇰🇷 South Korea' },
  { id: 'singapore', labelRu: '🇸🇬 Сингапур', labelEn: '🇸🇬 Singapore' },
  { id: 'russian', labelRu: '🇷🇺 Россия', labelEn: '🇷🇺 Russia' },
  { id: 'romanian', labelRu: '🇷🇴 Румыния', labelEn: '🇷🇴 Romania' },
  { id: 'senegal', labelRu: '🇸🇳 Сенегал', labelEn: '🇸🇳 Senegal' },
  { id: 'serbian', labelRu: '🇷🇸 Сербия', labelEn: '🇷🇸 Serbia' },
  { id: 'slovakia', labelRu: '🇸🇰 Словакия', labelEn: '🇸🇰 Slovakia' },
  { id: 'american', labelRu: '🇺🇸 США', labelEn: '🇺🇸 USA' },
  { id: 'thai', labelRu: '🇹🇭 Таиланд', labelEn: '🇹🇭 Thailand' },
  { id: 'taiwanese', labelRu: '🇹🇼 Тайвань', labelEn: '🇹🇼 Taiwan' },
  { id: 'tunisia', labelRu: '🇹🇳 Тунис', labelEn: '🇹🇳 Tunisia' },
  { id: 'ukrainian', labelRu: '🇺🇦 Украина', labelEn: '🇺🇦 Ukraine' },
  { id: 'filipina', labelRu: '🇵🇭 Филиппины', labelEn: '🇵🇭 Philippines' },
  { id: 'finnish', labelRu: '🇫🇮 Финляндия', labelEn: '🇫🇮 Finland' },
  { id: 'french', labelRu: '🇫🇷 Франция', labelEn: '🇫🇷 France' },
  { id: 'czech', labelRu: '🇨🇿 Чешская Республика', labelEn: '🇨🇿 Czech Republic' },
  { id: 'chilean', labelRu: '🇨🇱 Чили', labelEn: '🇨🇱 Chile' },
  { id: 'swiss', labelRu: '🇨🇭 Швейцария', labelEn: '🇨🇭 Switzerland' },
  { id: 'swedish', labelRu: '🇸🇪 Швеция', labelEn: '🇸🇪 Sweden' },
  { id: 'sri lanka', labelRu: '🇱🇰 Шри-Ланка', labelEn: '🇱🇰 Sri Lanka' },
  { id: 'ecuador', labelRu: '🇪🇨 Эквадор', labelEn: '🇪🇨 Ecuador' },
  { id: 'south africa', labelRu: '🇿🇦 Южная Африка', labelEn: '🇿🇦 South Africa' },
  { id: 'japanese', labelRu: '🇯🇵 Япония', labelEn: '🇯🇵 Japan' }
];

export function Adult() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const { fetchAdultSearch } = useApi();
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  
  // Start with a random category initially
  const [category, setCategory] = useState(() => {
    const randomIndex = 1 + Math.floor(Math.random() * (CATEGORIES.length - 1));
    return CATEGORIES[randomIndex].id;
  });
  const [page, setPage] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isRu = language === 'ru-RU';
  
  const hasAccess = true;

  const [ageConfirmed, setAgeConfirmed] = useState(() => localStorage.getItem('age_confirmed') === 'true');

  const initialCategoryRef = useRef(category);

  const loadVideos = useCallback(async (searchQuery: string, pageNum: number = 0, append: boolean = false) => {
    if (append) {
      setIsLoadingMore(true);
    } else {
      setLoading(true);
    }
    
    try {
      const data = await fetchAdultSearch(searchQuery, pageNum);
      if (Array.isArray(data)) {
        if (append) {
          setVideos(prev => {
            // Filter out duplicates
            const existingIds = new Set(prev.map(v => v.id));
            const newVideos = data.filter(v => !existingIds.has(v.id));
            return [...prev, ...newVideos];
          });
        } else {
          setVideos(data);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  }, [fetchAdultSearch]);

  useEffect(() => {
    if (hasAccess && ageConfirmed) {
      loadVideos(initialCategoryRef.current, 0);
    } else {
      setLoading(false);
    }
  }, [hasAccess, ageConfirmed, loadVideos]);

  const loadMore = useCallback(() => {
    if (loading || isLoadingMore || !hasAccess || !ageConfirmed) return;
    
    const activeTag = query || country || category;
    if (!activeTag) {
      // Infinite random mode
      const randomCat = CATEGORIES[1 + Math.floor(Math.random() * (CATEGORIES.length - 1))].id;
      const nextPage = page + 1;
      setPage(nextPage);
      loadVideos(randomCat, nextPage, true);
    } else {
      const nextPage = page + 1;
      setPage(nextPage);
      loadVideos(activeTag, nextPage, true);
    }
  }, [loading, isLoadingMore, hasAccess, ageConfirmed, category, country, query, page]);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scrollY = window.scrollY;
          const windowHeight = window.innerHeight;
          const documentHeight = document.documentElement.scrollHeight;
          
          if (scrollY + windowHeight >= documentHeight - 100) {
            loadMore();
          }
          ticking = false;
        });
        ticking = true;
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loadMore]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    (document.activeElement as HTMLElement)?.blur();
    if (hasAccess) {
      setPage(0);
      loadVideos(query || country || category, 0, false);
    }
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setCategory(val);
    setCountry('');
    setQuery('');
    setPage(0);
    if (hasAccess) {
      if (val === '') {
        const randomCat = CATEGORIES[1 + Math.floor(Math.random() * (CATEGORIES.length - 1))].id;
        loadVideos(randomCat, 0, false);
      } else {
        loadVideos(val, 0, false);
      }
    }
  };

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setCountry(val);
    setCategory('');
    setQuery('');
    setPage(0);
    if (hasAccess) {
      loadVideos(val, 0, false);
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
    <div className="px-3 sm:px-4 pb-20 pt-16 sm:pt-16">
      <div className="flex items-center gap-3 mb-3">
        <h1 className="text-xl font-extrabold">{t('privateCollection')} 🍓</h1>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mb-3">
        <select 
          className="w-full p-3 rounded-2xl outline-none text-xs sm:text-sm border-none appearance-none font-medium shadow-sm truncate"
          style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
          value={category}
          onChange={handleCategoryChange}
        >
          {CATEGORIES.map(c => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>

        <select 
          className="w-full p-3 rounded-2xl outline-none text-xs sm:text-sm border-none appearance-none font-medium shadow-sm truncate"
          style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
          value={country}
          onChange={handleCountryChange}
        >
          {ADULT_COUNTRIES.map(c => (
            <option key={c.id} value={c.id}>{isRu ? c.labelRu : c.labelEn}</option>
          ))}
        </select>
      </div>

      <form onSubmit={handleSearch} className="mb-4 relative">
        <input 
          type="text" 
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => {
            requestAnimationFrame(() => {
              window.scrollTo(0, 0);
              triggerViewportExpand();
            });
          }}
          placeholder={t('search')}
          className="w-full p-3 rounded-xl outline-none font-medium text-sm"
          style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
        />
      </form>



      {loading && !isLoadingMore ? (
        <div className="flex justify-center py-20 opacity-50 font-medium">Loading...</div>
      ) : (
        <>
          <ExoClickBanner18 />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 w-full">
            {videos.map((v, idx) => (
              <React.Fragment key={`${v.id}-${idx}`}>
                <div 
                  className="cursor-pointer"
                  onClick={() => navigate(`/adult/${v.id}`, { state: { category: query || country || category } })}
                >
                  <div className="aspect-[4/3] rounded-xl overflow-hidden mb-1.5 relative bg-[var(--hint-color)]">
                    <img 
                      src={v.poster} 
                      className="w-full h-full object-cover" 
                      alt="" 
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        const img = e.currentTarget;
                        const src = img.src;
                        if (src.includes('thumb-cdn77.xvideos-cdn.com')) {
                          img.src = src.replace('thumb-cdn77.xvideos-cdn.com', 'thumbs-gcore.xvideos-cdn.com');
                        } else if (src.includes('thumbs-gcore.xvideos-cdn.com')) {
                          img.src = src.replace('thumbs-gcore.xvideos-cdn.com', 'static-ss.xvideos-cdn.com');
                        } else {
                          img.onerror = null;
                          img.src = 'https://placehold.co/400x300/242f3d/ffffff?text=No+Preview';
                        }
                      }}
                    />
                    <div className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                      {v.duration}
                    </div>
                  </div>
                  <p className="text-sm font-semibold line-clamp-2 leading-snug break-words">{v.title}</p>
                </div>
                {(idx + 1) % 15 === 0 && (
                  <div className="col-span-2 sm:col-span-3 lg:col-span-4 w-full my-2">
                    <BannerAd type={(idx + 1) % 30 === 0 ? "mainbot" : "telegram"} />
                  </div>
                )}
                {(idx + 1) % 12 === 0 && (
                  <div className="col-span-2 sm:col-span-3 lg:col-span-4 w-full my-2">
                    <ExoClickNativeAd className="exo-native-ad-container" />
                  </div>
                )}
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
