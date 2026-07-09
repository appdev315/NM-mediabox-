import { useLanguage } from '../context/LanguageContext';
import { WebApp } from '../telegram';
import { Capacitor } from '@capacitor/core';

export function TopBanner() {
  const { t } = useLanguage();

  // Hide inside Telegram Mini App and on Adult domains/queries
  const hostname = window.location.hostname;
  const isAdultDomain = hostname === 'moviemaniak5555.xyz' || (hostname === 'localhost' && window.location.port === '3001');
  const isAdultQuery = window.location.href.includes('app=adult');
  const isAdultApp = isAdultDomain || isAdultQuery;

  if (WebApp.platform !== 'unknown' || isAdultApp || Capacitor.isNativePlatform()) {
    return null;
  }

  return (
    <div className="absolute top-4 right-4 z-50 flex flex-row items-center gap-2">
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
        href="/app-release.apk" 
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
          alert("iOS App is in development and will be available on TestFlight soon!");
        }}
        className="bg-gray-800 hover:bg-gray-900 text-white font-medium py-1.5 px-3 rounded-lg shadow-sm transition-transform active:scale-95 flex items-center gap-1.5 text-xs"
      >
        <span className="text-sm">🍏</span>
        <span>iOS</span>
      </a>
    </div>
  );
}
