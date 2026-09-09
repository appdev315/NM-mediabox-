import React from 'react';

export const MovieStaticBanners: React.FC = () => {
  return (
    <div className="w-full my-6 border-t border-white/10 pt-6">
      <div className="w-full flex justify-center items-center gap-4 sm:gap-6 flex-wrap overflow-hidden min-h-[250px]">
        {[0, 1, 2].map((idx) => (
          <div
            key={idx}
            style={{ width: '300px', height: '250px', maxWidth: '100%', flexShrink: 0 }}
            className="flex justify-center items-center rounded-2xl overflow-hidden shadow-lg bg-[#18181b] border border-white/10 transition-all hover:border-white/20"
          >
            <iframe
              src={`/adsterra-movie-banner.html?v=1&slot=static-${idx}`}
              width="300"
              height="250"
              scrolling="no"
              frameBorder="0"
              title={`adsterra-static-banner-${idx}`}
              style={{ width: '300px', height: '250px', border: 'none', overflow: 'hidden' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
