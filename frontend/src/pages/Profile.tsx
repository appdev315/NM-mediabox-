import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebApp } from '../telegram';
import { useLanguage, type Language } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

import { VIP_USERS } from '../config/vipUsers';

export function Profile() {
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [favorites, setFavorites] = useState<any[]>([]);
  // Use favorites to avoid unused var warning
  console.log(favorites.length);
  const [showPrivate, setShowPrivate] = useState(true);
  const [isVip, setIsVip] = useState(false);

  const user = WebApp.initDataUnsafe?.user || { first_name: 'Demo', id: 1 };

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
    
    // Read showPrivate and isVip
    const savedShowPrivate = localStorage.getItem('showPrivate');
    if (savedShowPrivate !== null) setShowPrivate(savedShowPrivate === 'true');
    
    let vipStatus = localStorage.getItem('vip_until');
    try {
      if (WebApp.CloudStorage) {
        const cloudVip = WebApp.CloudStorage?.getItem('vip_until');
        if (cloudVip) vipStatus = cloudVip;
      }
    } catch (e) {
      console.warn("CloudStorage not supported", e);
    }
    
    // Check config first
    const isConfigVip = user?.username && VIP_USERS.map((u: string) => u.toLowerCase()).includes(user.username.toLowerCase());
    
    if (isConfigVip || vipStatus === 'lifetime' || (vipStatus && Number(vipStatus) > Date.now())) {
      setIsVip(true);
    }
  }, [user?.id, user?.username]);

  const handleTogglePrivate = () => {
    if (!isVip) {
      if (WebApp.showAlert) WebApp.showAlert('This feature is only available for VIP users.');
      return;
    }
    const newVal = !showPrivate;
    setShowPrivate(newVal);
    localStorage.setItem('showPrivate', String(newVal));
  };

  return (
    <div className="p-4 pt-6 flex flex-col gap-4">
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
          ) : (
            user?.first_name?.charAt(0) || 'U'
          )}
        </div>
        <div>
          <h1 className="font-bold text-xl">{user?.first_name} {user?.last_name}</h1>
          {user?.username && <p className="opacity-90 text-sm">@{user.username}</p>}
        </div>
      </div>

      {/* Settings Section */}
      <div className="p-4 rounded-2xl shadow-sm flex flex-col gap-4" style={{ backgroundColor: 'var(--hint-color)' }}>
        
        {/* Language Picker */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌍</span>
            <h2 className="font-bold text-md">{t('language')}</h2>
          </div>
          <select 
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="p-1 rounded bg-black/10 dark:bg-white/10 outline-none text-sm font-medium"
            style={{ color: 'var(--text-color)' }}
          >
            <option value="ru-RU">Русский (RU)</option>
            <option value="en-US">English (US)</option>
            <option value="de-DE">Deutsch (DE)</option>
            <option value="fr-FR">Français (FR)</option>
            <option value="es-ES">Español (ES)</option>
          </select>
        </div>

        {/* Theme Picker */}
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎨</span>
            <h2 className="font-bold text-md">{t('theme')}</h2>
          </div>
          <select 
            value={theme}
            onChange={(e) => setTheme(e.target.value as any)}
            className="p-1 rounded bg-black/10 dark:bg-white/10 outline-none text-sm font-medium"
            style={{ color: 'var(--text-color)' }}
          >
            <option value="auto">{t('themeAuto')}</option>
            <option value="light">{t('themeLight')}</option>
            <option value="dark">{t('themeDark')}</option>
          </select>
        </div>

      </div>

      {/* Private Mode Toggle */}
      {isVip && (
        <div className="p-4 rounded-2xl shadow-sm" style={{ backgroundColor: 'var(--hint-color)' }}>
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">💎</span>
              <h2 className="font-bold text-lg">{t('privateModeTitle')}</h2>
            </div>
            <div 
              onClick={handleTogglePrivate}
              className={`w-12 h-6 rounded-full flex items-center p-1 cursor-pointer transition-colors`}
              style={{ backgroundColor: showPrivate ? 'var(--button-color)' : 'rgba(128,128,128,0.5)' }}
            >
              <div 
                className="bg-white w-4 h-4 rounded-full shadow-md transition-transform"
                style={{ transform: showPrivate ? 'translateX(24px)' : 'translateX(0)' }}
              />
            </div>
          </div>
          <p className="text-sm opacity-90">{t('privateModeDesc')}</p>
        </div>
      )}

    </div>
  );
}
