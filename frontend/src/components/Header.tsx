import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { WebApp } from '../telegram';

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ticking = false;
    let lastState = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const shouldShow = window.scrollY > 300 && location.pathname !== '/profile';
          if (shouldShow !== lastState) {
            lastState = shouldShow;
            setShowScrollTop(shouldShow);
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [location.pathname]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleOpenTelegram = () => {
    setIsOpen(false);
    if (WebApp.openTelegramLink) {
      WebApp.openTelegramLink('https://t.me/moviemaniakbot');
    } else {
      window.open('https://t.me/moviemaniakbot', '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenAndroid = () => {
    setIsOpen(false);
    window.open('https://drive.google.com/drive/folders/1WmyWGrQ26nFAWHdT6NeFolbwFypdmSbv?usp=share_link', '_blank', 'noopener,noreferrer');
  };

  const handleOpenIos = () => {
    setIsOpen(false);
    alert('Чтобы установить MediaBox на iPhone, нажмите кнопку «Поделиться» (квадрат со стрелочкой вверх внизу экрана) и выберите «На экран Домой» (Add to Home Screen).');
  };

  const handleOpenProfile = () => {
    setIsOpen(false);
    navigate('/profile');
  };

  return (
    <div 
      ref={menuRef}
      className="fixed right-3 sm:right-4 z-50 flex flex-col items-end"
      style={{ top: 'calc(16px + env(safe-area-inset-top))' }}
    >
      {/* Floating circular button ("Бублик") */}
      <button 
        onClick={() => {
          if (WebApp.HapticFeedback) {
            WebApp.HapticFeedback.impactOccurred('light');
          }
          setIsOpen(prev => !prev);
        }}
        className="w-10 h-10 sm:w-11 sm:h-11 rounded-full shadow-xl border border-white/10 flex items-center justify-center transition-transform active:scale-95 bg-gray-800 text-white hover:bg-gray-700"
        aria-label="Меню"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="mt-2 w-56 sm:w-64 bg-gray-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/10 p-2 flex flex-col gap-1 text-xs sm:text-sm animate-in fade-in slide-in-from-top-2 duration-150">
          <button
            onClick={handleOpenTelegram}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left transition-colors text-white font-medium"
          >
            <span className="text-base sm:text-lg">✈️</span>
            <span>{(t as any)('mediaBoxTelegram') || 'MediaBox в Telegram'}</span>
          </button>

          <button
            onClick={handleOpenAndroid}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left transition-colors text-white font-medium"
          >
            <span className="text-base sm:text-lg">🤖</span>
            <span>{(t as any)('downloadAndroid') || 'Скачать на Android'}</span>
          </button>

          <button
            onClick={handleOpenIos}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left transition-colors text-white font-medium"
          >
            <span className="text-base sm:text-lg">🍏</span>
            <span>{(t as any)('downloadIos') || 'Добавить на iPhone'}</span>
          </button>

          <div className="my-1 border-t border-white/10" />

          <button
            onClick={handleOpenProfile}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left transition-colors text-white font-medium"
          >
            <span className="text-base sm:text-lg">👤</span>
            <span>{t('profile') || 'Профиль / Настройки'}</span>
          </button>

          {showScrollTop && (
            <button
              onClick={() => {
                setIsOpen(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left transition-colors text-blue-400 font-medium"
            >
              <span className="text-base sm:text-lg">⬆️</span>
              <span>Наверх</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
