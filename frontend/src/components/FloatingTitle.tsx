import { useNavigate, useLocation } from 'react-router-dom';
import { WebApp } from '../telegram';

export function FloatingTitle() {
  const navigate = useNavigate();
  const location = useLocation();

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
      className="absolute top-4 left-4 z-50 cursor-pointer backdrop-blur-md px-4 py-2 rounded-xl shadow-lg border border-black/10 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
      style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-color)' }}
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
      <span className="text-lg opacity-80">🏠</span>
      <span className="font-black text-xl tracking-wider opacity-90 hover:opacity-100 transition-opacity">
        {isAdultApp ? 'MEDIABOX 🍓' : 'MEDIABOX 🍿'}
      </span>
    </div>
  );
}
