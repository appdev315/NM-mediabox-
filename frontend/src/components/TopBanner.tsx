import { useLocation } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';
import { WebApp } from '../telegram';
import { Capacitor } from '@capacitor/core';

export function TopBanner() {
  const { t } = useLanguage();
  const location = useLocation();

  // Hide on player pages
  if (location.pathname.includes('/movie/') || location.pathname.includes('/adult/')) {
    return null;
  }

  // Hide inside Telegram Mini App and on Adult domains/queries
  const hostname = window.location.hostname;
  const isAdultDomain = hostname === 'moviemaniak5555.xyz' || (hostname === 'localhost' && window.location.port === '3001');
  const isAdultQuery = window.location.href.includes('app=adult');
  const isAdultApp = isAdultDomain || isAdultQuery;

  if (WebApp.platform !== 'unknown' || isAdultApp || Capacitor.isNativePlatform()) {
    return null;
  }

  return (
    <div 
      className="absolute right-4 z-50 flex flex-row items-center gap-2"
      style={{ top: 'calc(16px + env(safe-area-inset-top))' }}
    >
      <a 
        href="https://t.me/TheMediaBoxBot" 
        target="_blank" 
        rel="noopener noreferrer"
        className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-1.5 px-3 rounded-lg shadow-sm transition-transform active:scale-95 flex items-center gap-1.5 text-xs"
      >
        <span className="text-sm">✈️</span>
        <span className="hidden sm:inline">{(t as any)('mediaBoxTelegram')}</span>
        <span className="sm:hidden">Telegram</span>
      </a>
      
      <a 
        href="/mediabox.apk" 
        download
        className="bg-green-500 hover:bg-green-600 text-white font-medium py-1.5 px-3 rounded-lg shadow-sm transition-transform active:scale-95 flex items-center gap-1.5 text-xs"
      >
        <span className="text-sm">🤖</span>
        <span>Android</span>
      </a>
      
      <a 
        href="#" 
        onClick={(e) => {
          e.preventDefault();
          alert("Чтобы установить MediaBox на iPhone, нажмите кнопку «Поделиться» (квадрат со стрелочкой вверх внизу экрана) и выберите «На экран Домой» (Add to Home Screen).");
        }}
        className="bg-gray-800 hover:bg-gray-900 text-white font-medium py-1.5 px-3 rounded-lg shadow-sm transition-transform active:scale-95 flex items-center gap-1.5 text-xs"
      >
        <span className="text-sm">🍏</span>
        <span>iOS</span>
      </a>
    </div>
  );
}
