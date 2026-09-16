import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { WebApp } from '../telegram';

interface AdsterraNativeCardProps {
  sectionId?: string;
}

export const AdsterraNativeCard: React.FC<AdsterraNativeCardProps> = ({ sectionId = 'default' }) => {
  const { t } = useLanguage();
  const [adBlocked, setAdBlocked] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    // Bidirectional observer: load iframe on approach, unload when far off-screen to reclaim RAM
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { rootMargin: '300px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    // Quick check if iframe load or profitableratecpmnetwork is blocked
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && !(window as any).canRunAds && (window as any).isAdBlockActive) {
        setAdBlocked(true);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [isVisible]);

  const handleSecretRoomClick = () => {
    const adultSiteUrl = 'https://moviemaniak5555.xyz/?app=adult';
    if (WebApp?.openLink && WebApp.platform !== 'unknown') {
      WebApp.openLink(adultSiteUrl);
    } else {
      window.open(adultSiteUrl, '_blank', 'noopener,noreferrer');
    }
  };

  if (adBlocked) {
    return (
      <div
        ref={cardRef}
        onClick={handleSecretRoomClick}
        className="flex flex-col gap-2 cursor-pointer group relative z-10 card-hover rounded-xl"
      >
        <div className="relative overflow-hidden rounded-xl shadow-sm aspect-[2/3] bg-gradient-to-br from-red-950/80 to-purple-950/80 border border-red-500/30 flex flex-col items-center justify-center p-3 text-center">
          <span className="text-3xl mb-2">🍓</span>
          <span className="text-xs font-bold text-white line-clamp-2">
            {t('secretRoomTab') || 'Тайная комната 18+'}
          </span>
          <span className="mt-3 text-[10px] bg-red-600 text-white font-bold px-2.5 py-1 rounded-md shadow-md">
            {t('openBanner') || 'Перейти'}
          </span>
        </div>
        <p className="text-[11px] font-bold text-center text-red-400 truncate">
          Secret Room
        </p>
      </div>
    );
  }

  return (
    <div ref={cardRef} className="flex flex-col gap-2 relative z-10 rounded-xl group">
      <div className="relative overflow-hidden rounded-xl shadow-sm aspect-[2/3] bg-[#18181b] border border-white/10 group-hover:border-blue-500/40 transition-colors">
        {/* Ad Tag Badge */}
        <div className="absolute top-2 right-2 z-20 pointer-events-none">
          <span className="bg-black/70 backdrop-blur-md text-white/90 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-white/10 shadow-sm">
            {t('adBadge') || 'Ad'}
          </span>
        </div>

        {/* Isolated Adsterra Native Iframe mounted lazily */}
        {isVisible ? (
          <iframe
            src={`/adsterra-native-card.html?v=1&slot=${encodeURIComponent(sectionId)}`}
            className="w-full h-full border-none overflow-hidden block"
            scrolling="no"
            title={`native-ad-${sectionId}`}
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#141416]">
            <span className="text-xl opacity-20">🍿</span>
          </div>
        )}
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
