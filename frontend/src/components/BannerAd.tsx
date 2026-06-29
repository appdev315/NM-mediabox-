import React from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';

export const BannerAd: React.FC<{ variant?: 'tall' | 'wide', type?: 'telegram' | 'adult' | 'mainbot' }> = ({ variant = 'tall', type = 'telegram' }) => {
  const { t } = useLanguage();

  return (
    <div 
         className={`w-full h-full flex flex-col flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl group relative transition-transform duration-300 hover:scale-[1.02] shadow-lg ${variant === 'wide' ? 'min-h-[6rem] max-h-24' : ''}`}
         style={{ backgroundColor: 'var(--hint-color)', border: '1px solid var(--button-color)' }}
         onClick={(e) => {
           e.preventDefault();
           // Open the ad in a new tab
           const adWindow = window.open('https://omg10.com/4/11214508', '_blank');
           
           if (adWindow) {
             adWindow.blur();
             window.focus();
           }

           if (type === 'telegram' || type === 'mainbot') {
             // Redirect the current tab to Telegram bot
             const botLink = type === 'mainbot' ? 'https://t.me/moviemaniakbot' : 'https://t.me/mediaboxxxbot';
             if (WebApp.platform !== 'unknown') {
               WebApp.openTelegramLink(botLink);
             } else {
               window.location.href = botLink;
             }
           } else {
             // Redirect to adult web app on the same domain
             window.location.href = '?app=adult';
           }
         }}
    >
      {/* Banner Aspect Ratio with beautiful image */}
      <div className={`w-full relative flex-1 bg-black flex flex-col items-center justify-center`}>
        <img 
          src={type === 'telegram' 
            ? "https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=800&auto=format&fit=crop" 
            : type === 'mainbot'
            ? "https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=800&auto=format&fit=crop"
            : "https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=800&auto=format&fit=crop"} 
          alt="Ad" 
          className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-40 transition-opacity duration-300"
        />
        <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 ${variant === 'wide' ? 'p-2' : 'p-4'}`}>
          <div className={`${variant === 'wide' ? 'w-8 h-8 mb-1' : 'w-12 h-12 mb-2'} ${type === 'adult' ? 'bg-red-500/80' : (type === 'mainbot' ? 'bg-purple-500/80' : 'bg-blue-500/80')} rounded-full flex items-center justify-center shadow-lg animate-bounce`}>
            <span className={variant === 'wide' ? 'text-lg' : 'text-2xl'}>{type === 'adult' ? '🔞' : (type === 'mainbot' ? '🍿' : '✈️')}</span>
          </div>
          <span className={`font-extrabold text-center text-white drop-shadow-md ${variant === 'wide' ? 'text-sm' : 'text-lg'}`}>
            {type === 'telegram' ? t('bannerTelegram') : (type === 'mainbot' ? t('bannerMainBot') : t('bannerAdult'))}
          </span>
          {variant !== 'wide' && (
            <span className="text-xs bg-black/50 px-2 py-1 rounded-md text-white/90 text-center mt-2 font-medium">
              Реклама
            </span>
          )}
        </div>
      </div>
      
      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black via-black/80 to-transparent z-10">
        <h3 className={`font-bold text-sm text-white truncate text-center ${type === 'telegram' ? 'text-blue-400' : 'text-red-400'}`}>Перейти</h3>
      </div>
    </div>
  );
};
