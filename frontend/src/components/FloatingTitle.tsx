import { useNavigate, useLocation } from 'react-router-dom';
import { WebApp } from '../telegram';
import { Capacitor } from '@capacitor/core';
import { useLanguage } from '../context/LanguageContext';

export function FloatingTitle() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const isWeb = WebApp.platform === 'unknown' && !Capacitor.isNativePlatform();

  // Hide on player pages
  if (location.pathname.includes('/movie/') || location.pathname.includes('/adult/')) {
    return null;
  }

  const hostname = window.location.hostname;
  const isAdultDomain = window.location.hostname === 'moviemaniak5555.xyz' || (hostname === 'localhost' && window.location.port === '3001');
  const isAdultQuery = window.location.href.includes('app=adult');
  const isAdultApp = isAdultDomain || isAdultQuery;

  // Hide the title/return button in 18+ Telegram bot (as requested by user)
  if (isAdultApp && WebApp.platform !== 'unknown') {
    return null;
  }

  return (
    <div 
      className="absolute left-4 z-50 cursor-pointer backdrop-blur-md px-5 py-2.5 rounded-xl shadow-[0_4px_10px_rgba(0,0,0,0.5),inset_0_2px_0_rgba(255,255,255,0.2),inset_0_-2px_0_rgba(0,0,0,0.2)] border border-black/30 transition-all hover:scale-105 active:scale-95 active:shadow-[0_2px_5px_rgba(0,0,0,0.5),inset_0_2px_0_rgba(0,0,0,0.2)] flex items-center justify-center bg-gradient-to-b from-gray-700 to-gray-900 text-white"
      style={{ 
        top: 'calc(16px + env(safe-area-inset-top))',
      }}
      onClick={() => {
        if (WebApp.platform !== 'unknown') {
          WebApp.HapticFeedback.impactOccurred('light');
        }
        if (isAdultApp) {
          window.location.href = '/';
        } else {
          navigate('/');
        }
      }}
    >
      <span className={`${isWeb ? 'text-3xl' : 'text-lg'} font-black tracking-wider drop-shadow-md`}>
        {isAdultApp ? t('secretRoomTab') : 'MEDIABOX'}
      </span>
    </div>
  );
}
