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
    <div className="w-full flex flex-col gap-2 p-4 pb-0 z-40 pt-[80px]">
      <a 
        href="https://t.me/TheMediaBoxBot" 
        target="_blank" 
        rel="noopener noreferrer"
        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-xl text-center shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
      >
        <span>✈️</span>
        {(t as any)('mediaBoxTelegram')}
      </a>
      
      <div className="flex gap-2">
        <a 
          href="/app-release.apk" 
          download
          className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-xl text-center shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2 text-sm"
        >
          <span>🤖</span>
          {(t as any)('downloadAndroid')}
        </a>
        
        <a 
          href="#" 
          onClick={(e) => {
            e.preventDefault();
            alert("iOS App is in development and will be available on TestFlight soon!");
          }}
          className="flex-1 bg-gray-800 hover:bg-gray-900 text-white font-bold py-3 px-4 rounded-xl text-center shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2 text-sm"
        >
          <span>🍏</span>
          {(t as any)('downloadIos')}
        </a>
      </div>
    </div>
  );
}
