import { useNavigate, useLocation } from 'react-router-dom';
import { WebApp } from '../telegram';
import { useAdManager } from '../context/AdManager';
import { useCallback, useRef } from 'react';

export function FloatingTitle() {
  const navigate = useNavigate();
  const location = useLocation();
  const { triggerPostAd } = useAdManager();

  const hostname = window.location.hostname;
  const isAdultDomain = window.location.hostname === 'moviemaniak5555.xyz' || (hostname === 'localhost' && window.location.port === '3001');
  const isAdultQuery = window.location.href.includes('app=adult');
  const isAdultApp = isAdultDomain || isAdultQuery;

  const isTelegram = Boolean(WebApp.platform && WebApp.platform !== 'unknown');

  const locationPathRef = useRef(location.pathname);
  locationPathRef.current = location.pathname;

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

  // Only show floating back button on detail pages (movie/series or adult video) outside Telegram
  const isDetailPage = location.pathname.startsWith('/movie/') || 
    (location.pathname.startsWith('/adult/') && location.pathname !== '/adult' && location.pathname !== '/adult/favorites');

  if (!isDetailPage || isTelegram) {
    return null;
  }

  return (
    <div 
      className="floating-back-btn fixed left-4 z-50 cursor-pointer w-12 h-12 rounded-full shadow-lg border border-white/10 active:scale-95 flex items-center justify-center bg-gray-800 text-white"
      style={{ top: 'calc(16px + env(safe-area-inset-top))' }}
      onClick={handleBackNavigation}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '-2px' }}>
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </div>
  );
}
