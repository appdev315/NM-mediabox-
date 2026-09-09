import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { WebApp } from '../telegram';

interface AdsterraNativeCardProps {
  sectionId?: string;
}

export const AdsterraNativeCard: React.FC<AdsterraNativeCardProps> = ({ sectionId = 'default' }) => {
  const { t } = useLanguage();
  const [adBlocked, setAdBlocked] = useState(false);

  useEffect(() => {
    // Quick check if iframe load or profitableratecpmnetwork is blocked
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && !(window as any).canRunAds && (window as any).isAdBlockActive) {
        setAdBlocked(true);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleBotClick = () => {
    const botUrl = 'https://t.me/moviemaniakbot';
    if (WebApp.platform !== 'unknown') {
      WebApp.openTelegramLink(botUrl);
      try {
        WebApp.close?.();
      } catch (_) {}
    } else {
      window.open(botUrl, '_blank', 'noopener,noreferrer');
    }
  };

  if (adBlocked) {
    return (
      <div
        onClick={handleBotClick}
        className="flex flex-col gap-2 cursor-pointer group relative z-10 card-hover rounded-xl"
      >
        <div className="relative overflow-hidden rounded-xl shadow-sm aspect-[2/3] bg-gradient-to-br from-blue-900/60 to-purple-900/60 border border-blue-500/30 flex flex-col items-center justify-center p-3 text-center">
          <span className="text-3xl mb-2">🍿</span>
          <span className="text-xs font-bold text-white line-clamp-2">
            {t('bannerMainBot') || 'Бесплатное кино в Telegram'}
          </span>
          <span className="mt-3 text-[10px] bg-blue-500 text-white font-bold px-2 py-1 rounded-md">
            {t('openBanner') || 'Перейти'}
          </span>
        </div>
        <p className="text-[11px] font-bold text-center text-blue-400 truncate">
          MediaBox Bot
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 relative z-10 rounded-xl group">
      <div className="relative overflow-hidden rounded-xl shadow-sm aspect-[2/3] bg-[#18181b] border border-white/10 group-hover:border-blue-500/40 transition-colors">
        {/* Ad Tag Badge */}
        <div className="absolute top-2 right-2 z-20 pointer-events-none">
          <span className="bg-black/70 backdrop-blur-md text-white/90 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-white/10 shadow-sm">
            {t('adBadge') || 'Ad'}
          </span>
        </div>

        {/* Isolated Adsterra Native Iframe */}
        <iframe
          src={`/adsterra-native-card.html?v=1&slot=${encodeURIComponent(sectionId)}`}
          className="w-full h-full border-none overflow-hidden block"
          scrolling="no"
          title={`native-ad-${sectionId}`}
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>

      {/* Footer hint */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-bold text-gray-400 group-hover:text-blue-400 transition-colors truncate">
          {t('recommendations') || 'Рекомендуем'}
        </span>
        <span className="text-[10px] text-gray-500 shrink-0">⭐ PROMO</span>
      </div>
    </div>
  );
};
