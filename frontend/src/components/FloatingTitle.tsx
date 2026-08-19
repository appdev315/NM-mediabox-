import { useNavigate, useLocation } from 'react-router-dom';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';
import { useAdManager } from '../context/AdManager';
import { useEffect, useCallback, useRef } from 'react';

export function FloatingTitle() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { triggerPostAd } = useAdManager();

  const hostname = window.location.hostname;
  const isAdultDomain = window.location.hostname === 'moviemaniak5555.xyz' || (hostname === 'localhost' && window.location.port === '3001');
  const isAdultQuery = window.location.href.includes('app=adult');
  const isAdultApp = isAdultDomain || isAdultQuery;

  const isMainRoute = ['/', '/adult', '/radio-tv', '/movies', '/favorites'].includes(location.pathname);
  const isTelegram = Boolean(WebApp.platform && WebApp.platform !== 'unknown');

  const locationPathRef = useRef(location.pathname);
  useEffect(() => {
    locationPathRef.current = location.pathname;
  }, [location.pathname]);

  const handleBackNavigation = useCallback(() => {
    // Only trigger ad if we are coming back from a movie
    if (locationPathRef.current.includes('/movie/')) {
      triggerPostAd();
    }
    
    // Fallback if there is no browser history (e.g. standalone PWA launched from a movie details link)
    if (window.history.length <= 1) {
      if (isAdultApp) {
        navigate('/adult');
      } else {
        navigate('/');
      }
    } else {
      navigate(-1);
    }
  }, [triggerPostAd, navigate, isAdultApp]);

  // Handle Telegram native back button
  useEffect(() => {
    if (isTelegram) {
      if (!isMainRoute) {
        WebApp.BackButton.show();
        WebApp.BackButton.onClick(handleBackNavigation);
        return () => {
          WebApp.BackButton.offClick(handleBackNavigation);
          WebApp.BackButton.hide();
        };
      } else {
        WebApp.BackButton.hide();
      }
    }
  }, [isMainRoute, isTelegram, handleBackNavigation]);

  if (isMainRoute) {
    // Hide the title/return button in 18+ app on main pages
    if (isAdultApp) {
      return null;
    }

    return (
      <div 
        className="fixed left-3 sm:left-4 z-40 cursor-pointer px-3.5 py-1.5 sm:px-5 sm:py-2.5 rounded-xl shadow-lg border border-white/10 active:scale-95 flex items-center justify-center bg-gray-800 text-white"
        style={{ top: 'calc(16px + env(safe-area-inset-top))' }}
        onClick={() => {
          if (WebApp.HapticFeedback) {
            WebApp.HapticFeedback.impactOccurred('light');
          }
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      >
        <span className="text-sm sm:text-lg font-black tracking-wider drop-shadow-md">
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
      className="fixed left-4 z-50 cursor-pointer w-12 h-12 rounded-full shadow-lg border border-white/10 active:scale-95 flex items-center justify-center bg-gray-800 text-white"
      style={{ top: 'calc(16px + env(safe-area-inset-top))' }}
      onClick={() => {
        handleBackNavigation();
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '-2px' }}>
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </div>
  );
}
