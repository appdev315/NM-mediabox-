import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { Header } from '../components/Header';

export function AdultFavorites() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [privateFavs, setPrivateFavs] = useState<any[]>([]);

  useEffect(() => {
    setPrivateFavs(JSON.parse(localStorage.getItem('private_favs') || '[]'));
  }, []);

  const removePrivateFav = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newFavs = privateFavs.filter(f => f.id !== id);
    setPrivateFavs(newFavs);
    localStorage.setItem('private_favs', JSON.stringify(newFavs));
  };

  return (
    <div className="p-4 pt-24 pb-24 h-full flex flex-col">
      <div className="flex gap-2 mb-6 bg-black/20 p-1 rounded-xl overflow-x-auto hide-scrollbar">
        <button 
          className="px-3 py-2 flex-1 text-sm font-bold rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
          style={{ 
            backgroundColor: 'var(--button-color)',
            color: 'var(--button-text-color)'
          }}
        >
          {t('privateCollection') || 'Private'} 🍓
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {privateFavs.length === 0 ? (
          <div className="text-center mt-12 opacity-50" style={{ color: 'var(--text-color)' }}>
            {t('emptyList')}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {privateFavs.map((v: any, idx) => (
              <div 
                key={`${v.id}-${idx}`} 
                className="cursor-pointer active:scale-95 transition-transform group"
                onClick={() => navigate(`/adult/${v.id}`)}
              >
                <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-2 relative shadow-lg group-hover:shadow-xl transition-shadow">
                  <img src={v.poster} className="w-full h-full object-cover" alt="" />
                  <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                    {v.duration}
                  </div>
                  <button 
                    className="absolute top-2 right-2 p-2 bg-black/50 backdrop-blur-md rounded-full hover:scale-110 transition-transform shadow-md"
                    onClick={(e) => removePrivateFav(e, v.id)}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                </div>
                <p className="text-sm font-bold line-clamp-2 leading-snug" style={{ color: 'var(--text-color)' }}>{v.title}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      <Header />
    </div>
  );
}
