import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useLanguage, type Language } from '../context/LanguageContext';
import { WebApp } from '../telegram';
import { IosInstallModal } from './IosInstallModal';

const LANGUAGES_CONFIG: { code: Language; flag: string; label: string; fullName: string }[] = [
  { code: 'ru-RU', flag: '🇷🇺', label: 'RU', fullName: 'Русский' },
  { code: 'en-US', flag: '🇺🇸', label: 'EN', fullName: 'English' },
  { code: 'ko-KR', flag: '🇰🇷', label: 'KR', fullName: '한국어' },
  { code: 'id-ID', flag: '🇮🇩', label: 'ID', fullName: 'Indonesia' },
  { code: 'es-ES', flag: '🇪🇸', label: 'ES', fullName: 'Español' },
  { code: 'de-DE', flag: '🇩🇪', label: 'DE', fullName: 'Deutsch' },
  { code: 'fr-FR', flag: '🇫🇷', label: 'FR', fullName: 'Français' },
  { code: 'hi-IN', flag: '🇮🇳', label: 'IN', fullName: 'हिन्दी' },
  { code: 'fa-IR', flag: '🇮🇷', label: 'FA', fullName: 'فارسی' },
  { code: 'zh-CN', flag: '🇨🇳', label: 'CN', fullName: '中文' },
];

export function Header() {
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [showIosModal, setShowIosModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);

  const currentLang = LANGUAGES_CONFIG.find(l => l.code === language) || LANGUAGES_CONFIG[0];

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setIsLangOpen(false);
      }
    };

    if (isOpen || isLangOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, isLangOpen]);

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
    setShowIosModal(true);
  };

  const handleOpenProfile = () => {
    setIsOpen(false);
    navigate('/profile');
  };

  return (
    <>
      <div 
        className="fixed right-3 sm:right-4 z-50 flex flex-col items-end"
        style={{ top: 'calc(16px + env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-2">
          {/* Language Switcher Pill */}
          <div ref={langMenuRef} className="relative">
            <button 
              onClick={() => {
                if (WebApp.HapticFeedback) {
                  WebApp.HapticFeedback.impactOccurred('light');
                }
                setIsLangOpen(prev => !prev);
                setIsOpen(false);
              }}
              className="h-10 px-3 rounded-full shadow-xl border border-white/10 flex items-center gap-1.5 transition-transform active:scale-95 bg-gray-800/90 hover:bg-gray-700 text-white font-semibold text-xs tracking-wide backdrop-blur-md"
              aria-label="Выбор языка"
            >
              <span className="text-sm">{currentLang.flag}</span>
              <span>{currentLang.label}</span>
              <span className="text-[9px] opacity-70">▼</span>
            </button>

            {/* Language Dropdown */}
            {isLangOpen && (
              <div className="absolute right-0 mt-2 w-44 bg-gray-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/10 p-1.5 flex flex-col gap-1 text-xs max-h-72 overflow-y-auto hide-scrollbar z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                {LANGUAGES_CONFIG.map(l => (
                  <button
                    key={l.code}
                    onClick={() => {
                      setLanguage(l.code);
                      setIsLangOpen(false);
                      if (WebApp.HapticFeedback) {
                        WebApp.HapticFeedback.impactOccurred('medium');
                      }
                    }}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl transition-colors ${
                      language === l.code ? 'bg-white/20 text-white font-bold' : 'text-gray-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-base">{l.flag}</span>
                      <span>{l.fullName}</span>
                    </span>
                    {language === l.code && <span className="text-xs text-blue-400">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Floating circular menu button */}
          <div ref={menuRef} className="relative">
            <button 
              onClick={() => {
                if (WebApp.HapticFeedback) {
                  WebApp.HapticFeedback.impactOccurred('light');
                }
                setIsOpen(prev => !prev);
                setIsLangOpen(false);
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
              <div className="absolute right-0 mt-2 w-56 sm:w-64 bg-gray-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/10 p-2 flex flex-col gap-1 text-xs sm:text-sm animate-in fade-in slide-in-from-top-2 duration-150">
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
                  <span className="text-base sm:text-lg">⚙️</span>
                  <span>{t('settings') || 'Настройки'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <IosInstallModal isOpen={showIosModal} onClose={() => setShowIosModal(false)} />
    </>
  );
}

