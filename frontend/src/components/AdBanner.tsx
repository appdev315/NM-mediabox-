import React, { useEffect } from 'react';
import { useVip } from '../context/VipContext';
import { WebApp } from '../telegram';

const AdBanner: React.FC = () => {
  const { isVip, config } = useVip();

  // Load Adsgram script dynamically
  useEffect(() => {
    // Only load if ads are enabled in the current phase and user is not VIP
    if (config?.ads && !isVip) {
      const script = document.createElement('script');
      script.src = 'https://sad.adsgram.ai/js/sad.min.js';
      script.async = true;
      document.head.appendChild(script);

      return () => {
        document.head.removeChild(script);
      };
    }
  }, [config?.ads, isVip]);

  // Показывать баннер только если включена реклама и пользователь не VIP
  const isTelegram = !!WebApp.initDataUnsafe?.user;
  if (!config?.ads || isVip || isTelegram) {
    return null;
  }

  if (!isTelegram) {
    // Top banner for Web using Monetag Direct Link
    return (
      <div 
        className="w-full bg-orange-600/20 border-b border-orange-500/30 p-2 text-center cursor-pointer hover:bg-orange-600/30 transition-colors"
        onClick={() => window.open('https://omg10.com/4/11214508', '_blank')}
      >
        <div className="flex items-center justify-center gap-2">
          <span className="text-xl">🔥</span>
          <span className="font-bold text-sm md:text-base text-orange-400">Смотреть новинки кино без ограничений!</span>
          <span className="text-xs bg-orange-500/20 px-2 py-0.5 rounded text-orange-300 ml-2 border border-orange-500/30">Реклама</span>
        </div>
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
