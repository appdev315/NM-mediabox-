import React from 'react';

export const BannerAd: React.FC<{ variant?: 'tall' | 'wide' }> = ({ variant = 'tall' }) => {
  return (
    <div 
         className={`w-full flex-shrink-0 cursor-pointer overflow-hidden rounded-2xl group relative transition-transform duration-300 hover:scale-[1.02] shadow-lg ${variant === 'wide' ? 'h-24' : ''}`}
         style={{ backgroundColor: 'var(--hint-color)', border: '1px solid var(--button-color)' }}
         onClick={() => {
           window.open('https://omg10.com/4/11214508', '_blank');
           window.location.href = 'https://t.me/MovieManiak_bot?start=vip';
         }}
    >
      {/* Banner Aspect Ratio with beautiful image */}
      <div className={`w-full relative ${variant === 'tall' ? 'pt-[40%] sm:pt-[50%] md:pt-[150%] min-h-[150px]' : 'h-full'} bg-black flex flex-col items-center justify-center`}>
        <img 
          src="https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=800&auto=format&fit=crop" 
          alt="Cinema Ad" 
          className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-40 transition-opacity duration-300"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 z-10">
          <div className="w-12 h-12 bg-orange-500/80 rounded-full flex items-center justify-center mb-2 shadow-lg animate-bounce">
            <span className="text-2xl">🍿</span>
          </div>
          <span className="font-extrabold text-lg text-center text-white drop-shadow-md">
            Смотреть без ограничений
          </span>
          <span className="text-xs bg-black/50 px-2 py-1 rounded-md text-white/90 text-center mt-2 font-medium">
            Реклама
          </span>
        </div>
      </div>
      
      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black via-black/80 to-transparent z-10">
        <h3 className="font-bold text-sm text-white truncate text-center text-orange-400">Перейти</h3>
      </div>
    </div>
  );
};
