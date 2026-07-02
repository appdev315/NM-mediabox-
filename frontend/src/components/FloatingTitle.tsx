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
  const isAdultDomain = (hostname === 'localhost' && window.location.port === '3001');
  const isAdultQuery = window.location.search.includes('app=adult');
  const isAdultApp = isAdultDomain || isAdultQuery;

  return (
    <div 
      className="fixed top-2 left-1/2 transform -translate-x-1/2 z-50 cursor-pointer backdrop-blur-md px-4 py-1 rounded-full shadow-lg border border-black/10 transition-transform active:scale-95"
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
      <span className="font-black text-sm tracking-wider opacity-80 hover:opacity-100 transition-opacity">
        {isAdultApp ? 'MEDIABOX 🍓' : 'MEDIABOX 🍿'}
      </span>
    </div>
  );
}
