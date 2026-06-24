import { useEffect, useState } from 'react';

import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';

export function Profile() {
  const { t } = useLanguage();
  const [favorites, setFavorites] = useState<any[]>([]);

  const user = WebApp.initDataUnsafe?.user || { first_name: 'Demo', id: 1 };

  useEffect(() => {
    const fetchFavorites = () => {
      const saved = JSON.parse(localStorage.getItem('favorites') || '[]');
      setFavorites(saved);
    };
    fetchFavorites();
  }, []);

  return (
    <div className="p-4">
      <div className="flex items-center gap-4 mb-8">
        <div 
          className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold"
          style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
        >
          {user?.first_name?.charAt(0) || 'U'}
        </div>
        <div>
          <h1 className="font-bold text-xl">{user?.first_name} {user?.last_name}</h1>
          {user?.username && <p className="opacity-90 text-sm">@{user.username}</p>}
        </div>
      </div>

      <h2 className="font-bold text-lg mb-4">{t('myFavorites')}</h2>
      {favorites.length === 0 ? (
        <p className="text-center opacity-80 mt-10">{t('emptyFavorites')}</p>
      ) : (
        <div className="space-y-3">
          {favorites.map((fav) => (
            <div 
              key={fav.id} 
              className="p-4 rounded-lg flex items-center justify-between cursor-pointer active:scale-95 transition-transform"
              style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
              onClick={() => window.location.href = `/movie/${fav.id}?type=${fav.type}`}
            >
              <div className="flex items-center gap-3">
                {fav.poster && <img src={fav.poster} alt={fav.title} className="w-10 h-14 object-cover rounded-md shadow-sm" />}
                <span className="font-bold text-sm line-clamp-2">{fav.title}</span>
              </div>
              <span className="text-xs font-bold" style={{ color: 'var(--button-color)' }}>★</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
