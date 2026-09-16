import React from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';

export const BannerAd: React.FC<{ variant?: 'tall' | 'wide', type?: 'telegram' | 'adult' | 'mainbot' }> = ({ variant = 'tall' }) => {
  const { t } = useLanguage();
  const adultSiteUrl = 'https://moviemaniak5555.xyz/?app=adult';

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (WebApp?.openLink && WebApp.platform !== 'unknown') {
      WebApp.openLink(adultSiteUrl);
    } else {
      window.open(adultSiteUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div 
         className={`w-full flex flex-col flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl group relative transition-transform duration-300 hover:scale-[1.02] shadow-lg ${variant === 'wide' ? 'h-24' : 'h-[180px]'}`}
         style={{ backgroundColor: 'var(--hint-color)', border: '1px solid rgba(239, 68, 68, 0.4)' }}
         onClick={handleClick}
    >
      {/* Banner Aspect Ratio with beautiful image */}
      <div className={`w-full relative flex-1 bg-black flex flex-col items-center justify-center`}>
        <img 
          src="/kiss-bg.png" 
          alt="Secret Room" 
          className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-40 transition-opacity duration-300"
        />
        <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 ${variant === 'wide' ? 'p-2' : 'p-4'}`}>
          <div className={`${variant === 'wide' ? 'w-8 h-8 mb-1' : 'w-12 h-12 mb-2'} bg-red-500/80 rounded-full flex items-center justify-center shadow-lg`}>
            <span className={variant === 'wide' ? 'text-lg' : 'text-2xl'}>🍓</span>
          </div>
          <span className={`font-extrabold text-center text-white drop-shadow-md ${variant === 'wide' ? 'text-sm' : 'text-lg'}`}>
            {t('secretRoomTab') || t('bannerAdult') || 'Тайная комната 🍓'}
          </span>
          {variant !== 'wide' && (
            <span className="text-xs bg-black/50 px-2 py-1 rounded-md text-white/90 text-center mt-2 font-medium">
              {t('adBadge') || 'VIP'}
            </span>
          )}
        </div>
      </div>
      
      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black via-black/80 to-transparent z-10">
        <h3 className="font-bold text-sm text-red-400 truncate text-center">{t('openBanner') || 'Перейти'}</h3>
      </div>
    </div>
  );
};
