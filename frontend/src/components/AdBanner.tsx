import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { WebApp } from '../telegram';

const AdBanner: React.FC = () => {



  // Load Adsgram script dynamically
  useEffect(() => {
    // Always load Adsgram
    if (true) {
      const script = document.createElement('script');
      script.src = 'https://sad.adsgram.ai/js/sad.min.js';
      script.async = true;
      document.head.appendChild(script);

      return () => {
        document.head.removeChild(script);
      };
    }
  }, []);

  const isTelegram = !!WebApp.initDataUnsafe?.user;
  const location = useLocation();

  if (isTelegram) {
    return null;
  }

  // Hide on player pages so it doesn't block the UI
  if (location.pathname.includes('/movie/') || location.pathname.includes('/adult/')) {
    return null;
  }

  if (!isTelegram) {
    // Top banner for Web using Monetag Direct Link
    return (
      <div 
        className="fixed top-0 left-0 right-0 z-[100] w-full bg-black/80 backdrop-blur-md border-b-2 border-orange-500 p-6 md:p-8 text-center cursor-pointer hover:bg-black transition-colors shadow-lg flex items-center justify-center gap-4 overflow-hidden"
        onClick={() => {
           window.open('https://omg10.com/4/11214508', '_blank');
           WebApp.openTelegramLink('https://t.me/mediaboxxxbot');
        }}
      >
        {/* Background texture */}
        <div className="absolute inset-0 opacity-20 bg-[url('https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800&auto=format&fit=crop')] bg-cover bg-center mix-blend-overlay pointer-events-none"></div>
        
        <span className="text-3xl animate-pulse relative z-10">🔞</span>
        <span className="font-extrabold text-base md:text-lg text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-yellow-300 relative z-10 drop-shadow-md">
          Еще больше приватного контента!
        </span>
        <span className="text-sm bg-orange-500 text-white font-bold px-3 py-1 rounded shadow-sm relative z-10 uppercase tracking-wide">
          Получить
        </span>
      </div>
    );
  }

  // TODO: Когда будет получен blockId от Adsgram, 
  // здесь будет логика вызова баннера (например: window.Adsgram.init({ blockId: "..." }).show())
  // Пока оставляем визуальную заглушку для тестирования верстки
  
  return (
    <div className="fixed bottom-20 left-0 right-0 z-[100] p-2 flex justify-center pointer-events-none">
      <div 
        className="w-full max-w-sm rounded-xl p-3 shadow-lg border backdrop-blur-md pointer-events-auto flex items-center justify-between"
        style={{ 
          backgroundColor: 'rgba(0, 0, 0, 0.7)', 
          borderColor: 'rgba(255, 255, 255, 0.2)',
          color: 'white'
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center font-bold">
            AD
          </div>
          <div>
            <h4 className="font-bold text-sm">Место для рекламы</h4>
            <p className="text-xs opacity-70">Ожидание Block ID от Adsgram</p>
          </div>
        </div>
        <button 
          className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
          onClick={() => {
            // Эмуляция вызова рекламы
            if ((window as any).Adsgram) {
              alert('Adsgram SDK загружен! Для показа нужен Block ID.');
            } else {
              alert('Скрипт загружается...');
            }
          }}
        >
          Тест
        </button>
      </div>
    </div>
  );
};

export default AdBanner;
