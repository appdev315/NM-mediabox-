import { useEffect, useState, lazy, Suspense } from 'react';

import { QRCodeSVG } from 'qrcode.react';
import { WebApp } from '../telegram';
import { useLanguage, LANGUAGES_CONFIG } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

const RadioTVContent = lazy(() => import('./RadioTV').then(m => ({ default: m.RadioTVContent })));

export function Profile() {
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [activeMediaTab, setActiveMediaTab] = useState<'tv' | 'radio' | null>(null);

  const isAdultApp = window.location.hostname === 'moviemaniak5555.xyz' || (window.location.hostname === 'localhost' && window.location.port === '3001') || window.location.search.includes('app=adult');
  const [showDonationModal, setShowDonationModal] = useState(false);
  const cryptoAddress = (import.meta as any).env?.VITE_DONATION_TRC20 || 'TKA34UexUySwB4CTbPaam4WEKGQjb4sU1U';
  const user = WebApp.initDataUnsafe?.user;

  useEffect(() => {
    // Read showPrivate
  }, [user?.id, user?.username]);

  if (activeMediaTab) {
    return (
      <div 
        className="p-4 flex flex-col gap-4"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveMediaTab(null)}
            className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-sm font-bold flex items-center gap-2 transition-all cursor-pointer"
            style={{ color: 'var(--text-color)' }}
          >
            <span>←</span>
            <span>{t('profile') || 'Назад'}</span>
          </button>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-color)' }}>
            {activeMediaTab === 'tv' ? (t('tab_tv') || 'Онлайн ТВ') : (t('tab_radio') || 'Радио')}
          </h1>
        </div>
        <Suspense fallback={
          <div className="flex items-center justify-center p-12 min-h-[300px]">
            <div className="w-8 h-8 border-4 border-[var(--button-color)] border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <RadioTVContent activeTab={activeMediaTab} />
        </Suspense>
      </div>
    );
  }

  return (
    <div 
      className="p-4 flex flex-col gap-4"
      style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
    >
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold">{t('profile') || 'Profile'}</h1>
      </div>
      
      <div className="flex items-center gap-4 mb-2">
        <div 
          className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold overflow-hidden"
          style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
        >
          {user?.photo_url ? (
            <img src={user.photo_url} alt="Profile" className="w-full h-full object-cover" />
          ) : user ? (
            user.first_name?.charAt(0) || 'U'
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="19" cy="12" r="1"></circle>
              <circle cx="5" cy="12" r="1"></circle>
            </svg>
          )}
        </div>
        <div>
          <h1 className="font-bold text-xl">{user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : (t('menu') || 'Menu')}</h1>
          {user?.username && <p className="opacity-90 text-sm mb-1">@{user.username}</p>}
          {isAdultApp && user?.username === 'appdev315' && (
            <div className="flex gap-2 items-center flex-wrap mt-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-500 font-bold text-xs">
                🛠 Developer
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Online TV & Radio Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setActiveMediaTab('tv')}
          className="p-4 rounded-2xl flex flex-col items-center justify-center gap-2 shadow-sm cursor-pointer transition-transform active:scale-95 text-center border border-white/5"
          style={{ backgroundColor: 'var(--hint-color)' }}
        >
          <span className="text-3xl">📺</span>
          <span className="font-bold text-sm" style={{ color: 'var(--text-color)' }}>{t('tab_tv') || 'Онлайн ТВ'}</span>
        </button>

        <button
          onClick={() => setActiveMediaTab('radio')}
          className="p-4 rounded-2xl flex flex-col items-center justify-center gap-2 shadow-sm cursor-pointer transition-transform active:scale-95 text-center border border-white/5"
          style={{ backgroundColor: 'var(--hint-color)' }}
        >
          <span className="text-3xl">📻</span>
          <span className="font-bold text-sm" style={{ color: 'var(--text-color)' }}>{t('tab_radio') || 'Радио'}</span>
        </button>
      </div>

      {/* Settings Section */}
      <div className="p-4 rounded-2xl shadow-sm flex flex-col gap-4" style={{ backgroundColor: 'var(--hint-color)' }}>
        
        {/* Theme Segmented Control */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🎨</span>
            <h2 className="font-bold text-md">{t('theme')}</h2>
          </div>
          <div className="flex w-full bg-black/10 dark:bg-white/5 rounded-lg p-1 relative">
            <button
              onClick={() => setTheme('auto')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-300 z-10 ${
                theme === 'auto' ? 'bg-white dark:bg-[#1c1c1e] shadow-sm text-black dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t('themeAuto')}
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-300 z-10 ${
                theme === 'light' ? 'bg-white dark:bg-[#1c1c1e] shadow-sm text-black dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t('themeLight')}
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all duration-300 z-10 ${
                theme === 'dark' ? 'bg-white dark:bg-[#1c1c1e] shadow-sm text-black dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t('themeDark')}
            </button>
          </div>
        </div>

        {/* Language Dropdown Section */}
        <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🌐</span>
            <h2 className="font-bold text-md">{t('language') || 'Язык'}</h2>
          </div>
          <div className="relative w-full">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as any)}
              className="w-full h-11 px-3.5 pr-10 rounded-xl text-sm font-semibold border border-white/10 outline-none appearance-none cursor-pointer shadow-sm transition-all"
              style={{
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-color)'
              }}
            >
              {LANGUAGES_CONFIG.map((lang) => (
                <option 
                  key={lang.code} 
                  value={lang.code} 
                  style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-color)' }}
                >
                  {lang.flag} {lang.name} ({lang.label})
                </option>
              ))}
            </select>
            <div 
              className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-xs opacity-60"
              style={{ color: 'var(--text-color)' }}
            >
              ▼
            </div>
          </div>
        </div>
      </div>

      {/* Support Creator */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="p-4 rounded-2xl flex items-center justify-between shadow-sm cursor-pointer hover:bg-black/10 transition-colors border border-orange-500/20"
             style={{ backgroundColor: 'var(--hint-color)' }}
             onClick={() => setShowDonationModal(true)}
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-orange-500/20 text-orange-500">
              <span className="text-xl">☕️</span>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base" style={{ color: 'var(--text-color)' }}>{t('supportCreator')}</span>
              <span className="text-xs opacity-70" style={{ color: 'var(--text-color)' }}>{t('supportSubtitle')}</span>
            </div>
          </div>
          <div className="opacity-50 text-xl" style={{ color: 'var(--text-color)' }}>›</div>
        </div>

        <div className="p-4 rounded-2xl flex items-center justify-between shadow-sm cursor-pointer hover:bg-black/10 transition-colors border border-blue-500/20"
             style={{ backgroundColor: 'var(--hint-color)' }}
              onClick={() => {
                if (WebApp.platform !== 'unknown') {
                  WebApp.openTelegramLink('https://t.me/appdev315');
                } else {
                  window.open('https://t.me/appdev315', '_blank', 'noopener,noreferrer');
                }
              }}
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-500/20 text-blue-500">
              <span className="text-xl">🎧</span>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base" style={{ color: 'var(--text-color)' }}>{t('supportContact') || 'Написать в поддержку'}</span>
              <span className="text-xs opacity-70" style={{ color: 'var(--text-color)' }}>{t('supportContactSubtitle') || 'Связаться с разработчиком'}</span>
            </div>
          </div>
          <div className="opacity-50 text-xl" style={{ color: 'var(--text-color)' }}>›</div>
        </div>
      </div>

      {/* Movie Bot Link */}
      <div className="p-4 rounded-2xl shadow-sm mb-4" style={{ backgroundColor: 'var(--hint-color)' }}>
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎬</span>
            <h2 className="font-bold text-lg">{t('mainBotTitle') || 'Основной Бот (Фильмы и ТВ)'}</h2>
          </div>
        </div>
        <p className="text-sm opacity-90 mb-3">{t('mainBotDesc') || 'Смотрите новинки кино и сериалов бесплатно и без ограничений.'}</p>
        
        <button 
          onClick={() => {
            if (WebApp.platform !== 'unknown') {
              WebApp.openTelegramLink('https://t.me/moviemaniakbot');
              WebApp.close();
            } else {
              window.open('https://t.me/moviemaniakbot', '_blank', 'noopener,noreferrer');
            }
          }}
          className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
          style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
        >
          <span>🍿</span> {t('openMainBot') || 'Открыть Бота с Фильмами'}
        </button>
      </div>

      {/* 18+ Adult Bot Link */}
      <div className="p-4 rounded-2xl shadow-sm" style={{ backgroundColor: 'var(--hint-color)' }}>
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔥</span>
            <h2 className="font-bold text-lg">{t('privateBotTitle') || 'Тайная комната'}</h2>
          </div>
        </div>
        <p className="text-sm opacity-90 mb-3">{t('privateModeDesc') || 'Эксклюзивный контент без цензуры (18+). Полностью бесплатно!'}</p>
        
        <button 
          onClick={() => {
            const adultSiteUrl = 'https://moviemaniak5555.xyz/?app=adult';
            if (WebApp?.openLink && WebApp.platform !== 'unknown') {
              WebApp.openLink(adultSiteUrl);
            } else {
              window.open(adultSiteUrl, '_blank', 'noopener,noreferrer');
            }
          }}
          className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
          style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
        >
          <span>🍓</span> {t('goToSite') || 'Перейти на сайт'}
        </button>
      </div>
      {showDonationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85"
             onClick={() => setShowDonationModal(false)}>
          <div className="rounded-3xl p-6 max-w-sm w-full border shadow-2xl relative"
               style={{ backgroundColor: 'var(--bg-color)', borderColor: 'var(--hint-color)' }}
               onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-xl" style={{ color: 'var(--text-color)' }}>{t('supportProject') || 'Support Project'}</h3>
              <button onClick={() => setShowDonationModal(false)} className="opacity-50 p-1" style={{ color: 'var(--text-color)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <div className="flex flex-col items-center mb-6">
              <div className="bg-white p-4 rounded-2xl shadow-sm mb-4">
                <QRCodeSVG value={cryptoAddress} size={200} level={"H"} />
              </div>
              <p className="font-medium opacity-90 text-center mb-1" style={{ color: 'var(--text-color)' }}>USDT (TRC20)</p>
              <p className="text-xs opacity-60 text-center mb-4" style={{ color: 'var(--text-color)' }}>{t('scanQr') || 'Scan QR or copy the address below'}</p>
              
              <div className="w-full bg-black/5 dark:bg-white/5 rounded-xl p-3 flex items-center justify-between border" style={{ borderColor: 'var(--hint-color)' }}>
                <span className="text-xs font-mono truncate mr-2" style={{ color: 'var(--text-color)' }}>{cryptoAddress}</span>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(cryptoAddress);
                    WebApp?.showAlert(t('addressCopied') || 'Address copied to clipboard!');
                  }}
                  className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
                >
                  {t('copy') || 'Copy'}
                </button>
              </div>
            </div>
            
            <button 
              onClick={() => setShowDonationModal(false)}
              className="w-full py-3 rounded-xl font-bold transition-transform active:scale-[0.98] bg-black/10 dark:bg-white/10"
              style={{ color: 'var(--text-color)' }}
            >
              {t('close') || 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
