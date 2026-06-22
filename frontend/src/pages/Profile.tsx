import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { WebApp } from '../telegram';

export function Profile() {
  const { request, loading } = useApi();
  const [favorites, setFavorites] = useState<any[]>([]);

  const user = WebApp.initDataUnsafe?.user || { first_name: 'Demo', id: 1 };

  useEffect(() => {
    const fetchFavorites = async () => {
      const data = await request('/user/favorites');
      if (data?.favorites) setFavorites(data.favorites);
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
          {user?.username && <p className="opacity-60 text-sm">@{user.username}</p>}
        </div>
      </div>

      <h2 className="font-bold text-lg mb-4">Мое избранное</h2>
      {loading ? (
        <div className="skeleton h-20 w-full rounded-lg" />
      ) : favorites.length === 0 ? (
        <p className="text-center opacity-50 mt-10">Тут пока пусто 🎬</p>
      ) : (
        <div className="space-y-3">
          {favorites.map((fav) => (
            <div 
              key={fav.movie_id} 
              className="p-4 rounded-lg flex items-center justify-between"
              style={{ backgroundColor: 'var(--hint-color)', color: 'var(--text-color)' }}
            >
              <span>ID фильма: {fav.movie_id}</span>
              <span className="text-xs opacity-60">Сохранено</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
