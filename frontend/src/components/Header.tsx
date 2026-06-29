import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    if (location.pathname !== '/radio-tv') {
      setShowScrollTop(false);
      return;
    }
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [location.pathname]);

  return (
    <button 
      onClick={() => {
        if (showScrollTop) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          navigate('/profile');
        }
      }}
      className="fixed bottom-24 right-4 z-50 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform active:scale-95 border"
      style={{ 
        backgroundColor: 'var(--bg-color)',
        borderColor: 'var(--button-color)', 
        color: 'var(--text-color)' 
      }}
    >
      {showScrollTop ? (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5"></line>
          <polyline points="5 12 12 5 19 12"></polyline>
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      )}
    </button>
  );
}
