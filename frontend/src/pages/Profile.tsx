import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useVip } from '../context/VipContext';



export function Profile() {
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { isVip, showVipModal } = useVip();
  const [favorites, setFavorites] = useState<any[]>([]);
  // Use favorites to avoid unused var warning
  console.log(favorites.length);
  const [showDonationModal, setShowDonationModal] = useState(false);
  const cryptoAddress = 'TKA34UexUySwB4CTbPaam4WEKGQjb4sU1U';

  const user = WebApp.initDataUnsafe?.user;

  useEffect(() => {
    const handleBack = () => navigate(-1);
    WebApp.BackButton.show();
    WebApp.BackButton.onClick(handleBack);
    return () => {
      WebApp.BackButton.hide();
      WebApp.BackButton.offClick(handleBack);
    };
  }, [navigate]);

  useEffect(() => {
    const fetchFavorites = () => {
      const saved = JSON.parse(localStorage.getItem('favorites') || '[]');
      setFavorites(saved);
    };
    fetchFavorites();
    
    // Read showPrivate
  }, [user?.id, user?.username]);



  return (
    <div className="p-4 pt-24 flex flex-col gap-4">
      <div className="flex items-center gap-3 mb-2">
        <button 
          onClick={() => navigate(-1)}
          className="p-2 bg-black/20 rounded-full shadow-md hover:scale-110 transition-transform"
          style={{ color: 'var(--text-color)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <h1 className="text-2xl font-bold">{t('profile' as any) || 'Profile'}</h1>
      </div>
      
      <div className="flex items-center gap-4 mb-4">
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
          {isVip ? (
            <div className="flex gap-2 items-center flex-wrap mt-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/30 text-pink-500 font-bold text-xs">
                💎 VIP Member
              </div>
              {user?.username === 'appdev315' && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-cyan-500 font-bold text-xs">
                  🛠 Developer
                </div>
              )}
            </div>
          ) : (
            <button 
              onClick={showVipModal}
              className="mt-1 flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors font-medium text-xs shadow-sm active:scale-95" style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
            >
              {t('buyVip')}
            </button>
          )}
        </div>
      </div>

      {/* Settings Section */}
      <div className="p-4 rounded-2xl shadow-sm flex flex-col gap-4" style={{ backgroundColor: 'var(--hint-color)' }}>
        
        {/* Language Selector */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🌍</span>
            <h2 className="font-bold text-md">{t('language')}</h2>
          </div>
          <div className="relative">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as any)}
              className="w-full appearance-none bg-black/10 dark:bg-white/5 rounded-lg p-3 text-sm font-medium outline-none border border-transparent focus:border-[var(--button-color)] transition-colors"
              style={{ color: 'var(--text-color)' }}
            >
              <option value="ru-RU">🇷🇺 Русский (RU)</option>
              <option value="en-US">🇺🇸 English (US)</option>
              <option value="ko-KR">🇰🇷 한국어 (KR)</option>
              <option value="id-ID">🇮🇩 Bahasa Indonesia (ID)</option>
              <option value="hi-IN">🇮🇳 हिन्दी (IN)</option>
              <option value="fa-IR">🇮🇷 فارسی (IR)</option>
              <option value="es-ES">🇪🇸 Español (ES)</option>
              <option value="de-DE">🇩🇪 Deutsch (DE)</option>
              <option value="fr-FR">🇫🇷 Français (FR)</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4" style={{ color: 'var(--text-color)' }}>
              <svg className="fill-current h-4 w-4 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>
        </div>

        {/* Theme Segmented Control */}
        <div className="flex flex-col gap-2 mt-2">
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
                 window.open('https://t.me/appdev315', '_blank');
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
            <h2 className="font-bold text-lg">{t('mainBotTitle' as any) || 'Основной Бот (Фильмы и ТВ)'}</h2>
          </div>
        </div>
        <p className="text-sm opacity-90 mb-3">{t('mainBotDesc' as any) || 'Смотрите новинки кино и сериалов бесплатно и без ограничений.'}</p>
        
        <button 
          onClick={() => {
            if (WebApp.platform !== 'unknown') {
              WebApp.openTelegramLink('https://t.me/M_Box_bot');
              WebApp.close();
            } else {
              window.open('https://t.me/M_Box_bot', '_blank');
            }
          }}
          className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
          style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
        >
          <span>🍿</span> {t('openMainBot' as any) || 'Открыть Бота с Фильмами'}
        </button>
      </div>

      {/* 18+ Adult Bot Link */}
      <div className="p-4 rounded-2xl shadow-sm" style={{ backgroundColor: 'var(--hint-color)' }}>
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔥</span>
            <h2 className="font-bold text-lg">{t('privateBotTitle') || 'Приватный VIP Клуб'}</h2>
          </div>
        </div>
        <p className="text-sm opacity-90 mb-3">{t('privateModeDesc') || 'Эксклюзивный контент без цензуры. Доступен только VIP подписчикам.'}</p>
        
        {isVip ? (
          <button 
            onClick={() => {
              if (WebApp.platform !== 'unknown') {
                WebApp.openTelegramLink('https://t.me/mediaboxxxbot');
                WebApp.close();
              } else {
                window.open('https://t.me/mediaboxxxbot', '_blank');
              }
            }}
            className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
            style={{ backgroundColor: 'var(--button-color)', color: 'var(--button-text-color)' }}
          >
            <span>🚀</span> {t('open18Bot') || 'Открыть 18+ Бота'}
          </button>
        ) : (
          <button 
            onClick={() => {
              if (WebApp.platform !== 'unknown') {
                showVipModal();
              } else {
                window.open('https://t.me/mediaboxxxbot', '_blank');
              }
            }}
            className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-md border border-orange-500/30"
            style={{ background: 'linear-gradient(to right, #f97316, #eab308)', color: 'white' }}
          >
            <span>⭐️</span> {t('buyVipForAccess') || 'Купить VIP для доступа'}
          </button>
        )}
      </div>
      {showDonationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
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
