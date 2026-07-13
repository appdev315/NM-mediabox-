import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { Header } from '../components/Header';

export function AdultFavorites() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [privateHistory, setPrivateHistory] = useState<any[]>([]);

  useEffect(() => {
    setPrivateHistory(JSON.parse(localStorage.getItem('history_adult') || '[]'));
  }, []);

  const removeHistoryItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newHist = privateHistory.filter(f => f.id !== id);
    setPrivateHistory(newHist);
    localStorage.setItem('history_adult', JSON.stringify(newHist));
  };

  const clearAllHistory = () => {
    const confirmMsg = t('confirmClearHistory') || 'Вы уверены, что хотите очистить всю историю?';
    if (window.confirm(confirmMsg)) {
      localStorage.removeItem('history_adult');
      setPrivateHistory([]);
    }
  };

  return (
    <div className="p-4 pt-24 pb-24 h-full flex flex-col">
      <div className="flex justify-between items-center mb-6 mt-2 px-1">
        <h2 className="text-xl font-extrabold tracking-tight" style={{ color: 'var(--text-color)' }}>
          {t('myFavorites') || 'История'} 🍓
        </h2>
        {privateHistory.length > 0 && (
          <button 
            onClick={clearAllHistory}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95 border"
            style={{ 
              backgroundColor: 'rgba(239, 68, 68, 0.1)', 
              color: 'rgb(248, 113, 113)',
              borderColor: 'rgba(239, 68, 68, 0.2)' 
            }}
          >
            {t('clearHistory') || 'Очистить историю'}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {privateHistory.length === 0 ? (
          <div className="text-center mt-12 opacity-50 font-bold" style={{ color: 'var(--text-color)' }}>
            {t('emptyFavorites') || 'История пуста'}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {privateHistory.map((v: any, idx) => (
              <div 
                key={`${v.id}-${idx}`} 
                className="cursor-pointer active:scale-95 transition-transform group relative"
                onClick={() => navigate(`/adult/${v.id}`)}
              >
                <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-2 relative shadow-lg group-hover:shadow-xl transition-shadow">
                  <img src={v.poster} className="w-full h-full object-cover" alt="" />
                  <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-lg backdrop-blur-sm">
                    {v.duration}
                  </div>
                  <button 
                    className="absolute top-2 right-2 w-7 h-7 bg-black/60 backdrop-blur-md rounded-full hover:scale-110 transition-transform shadow-md text-white font-bold leading-none flex items-center justify-center text-xs z-20 active:scale-95"
                    onClick={(e) => removeHistoryItem(e, v.id)}
                  >
                    ✕
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
