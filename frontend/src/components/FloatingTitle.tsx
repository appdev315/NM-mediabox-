import { useNavigate, useLocation } from 'react-router-dom';
import { WebApp } from '../telegram';
import { Capacitor } from '@capacitor/core';
import { useLanguage } from '../context/LanguageContext';
import { useEffect } from 'react';

export function FloatingTitle() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const isWeb = WebApp.platform === 'unknown' && !Capacitor.isNativePlatform();

  const hostname = window.location.hostname;
  const isAdultDomain = window.location.hostname === 'moviemaniak5555.xyz' || (hostname === 'localhost' && window.location.port === '3001');
  const isAdultQuery = window.location.href.includes('app=adult');
  const isAdultApp = isAdultDomain || isAdultQuery;

  // Define main routes where the Logo should be shown
  const isMainRoute = ['/', '/adult', '/radio-tv', '/movies', '/favorites'].includes(location.pathname);
  const isTelegram = WebApp.platform !== 'unknown';

  // Handle Telegram native back button
  useEffect(() => {
    if (isTelegram) {
      if (!isMainRoute) {
        WebApp.BackButton.show();
        const handleBack = () => {
          navigate(-1);
        };
        WebApp.BackButton.onClick(handleBack);
        return () => {
          WebApp.BackButton.offClick(handleBack);
          WebApp.BackButton.hide();
        };
      } else {
        WebApp.BackButton.hide();
      }
    }
  }, [isMainRoute, isTelegram, navigate]);

  if (isMainRoute) {
    // Hide the title/return button in 18+ Telegram bot on main pages (as originally requested)
    if (isAdultApp && isTelegram) {
      return null;
    }

    return (
      <div 
        className="fixed left-4 z-50 cursor-pointer backdrop-blur-md px-5 py-2.5 rounded-xl shadow-[0_4px_10px_rgba(0,0,0,0.5),inset_0_2px_0_rgba(255,255,255,0.2),inset_0_-2px_0_rgba(0,0,0,0.2)] border border-black/30 transition-all hover:scale-105 active:scale-95 active:shadow-[0_2px_5px_rgba(0,0,0,0.5),inset_0_2px_0_rgba(0,0,0,0.2)] flex items-center justify-center bg-gradient-to-b from-gray-700 to-gray-900 text-white"
        style={{ top: 'calc(16px + env(safe-area-inset-top))' }}
        onClick={() => {
          if (isTelegram) WebApp.HapticFeedback.impactOccurred('light');
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

  // Not a main route -> Show Back Button (if not in Telegram, as Telegram has its own)
  if (isTelegram) {
    return null;
  }

  return (
    <div 
      className="fixed left-4 z-50 cursor-pointer backdrop-blur-md w-12 h-12 rounded-full shadow-[0_4px_10px_rgba(0,0,0,0.5),inset_0_2px_0_rgba(255,255,255,0.2),inset_0_-2px_0_rgba(0,0,0,0.2)] border border-black/30 transition-all hover:scale-105 active:scale-95 flex items-center justify-center bg-gradient-to-b from-gray-700 to-gray-900 text-white"
      style={{ top: 'calc(16px + env(safe-area-inset-top))' }}
      onClick={() => {
        navigate(-1);
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '-2px' }}>
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </div>
  );
}
