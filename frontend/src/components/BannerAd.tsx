import React from 'react';

export const BannerAd: React.FC = () => {
  return (
    <div className="w-full flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl group relative transition-transform duration-300 hover:scale-[1.02]"
         style={{ backgroundColor: 'var(--hint-color)', border: '1px solid var(--button-color)' }}>
      {/* Banner Aspect Ratio (Matches movie poster roughly or banner size) */}
      <div className="w-full relative pt-[40%] sm:pt-[50%] md:pt-[150%] bg-black/20 flex flex-col items-center justify-center min-h-[150px]">
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
          <div className="w-12 h-12 bg-black/40 rounded-full flex items-center justify-center mb-2 animate-pulse">
            <span className="text-2xl">💰</span>
          </div>
          <span className="font-bold text-sm text-center text-white/90">
            [TEST] Рекламный Баннер
          </span>
          <span className="text-xs text-white/50 text-center mt-1">
            Здесь будет нативный In-Page блок
          </span>
        </div>
      </div>
      
      {/* Bottom bar similar to MovieCard */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
        <h3 className="font-bold text-sm text-white truncate text-center">Реклама</h3>
      </div>
    </div>
  );
};
