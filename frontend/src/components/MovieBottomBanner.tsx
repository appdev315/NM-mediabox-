import React from 'react';

export const MovieBottomBanner: React.FC = () => {
  return (
    <div className="w-full flex flex-col items-center justify-center my-6 px-2 overflow-hidden select-none">
      {/* Desktop & Tablet Banner: 728x90 */}
      <div className="hidden md:flex justify-center items-center w-[728px] h-[90px] max-w-full rounded-xl overflow-hidden bg-[#12141a]/60 border border-white/10 shadow-lg">
        <iframe
          src="/adsterra-movie-leaderboard.html?v=1"
          width="728"
          height="90"
          scrolling="no"
          frameBorder="0"
          title="adsterra-movie-leaderboard"
          loading="lazy"
          style={{ width: '728px', height: '90px', border: 'none', overflow: 'hidden' }}
        />
      </div>

      {/* Mobile Banner: 320x50 */}
      <div className="flex md:hidden justify-center items-center w-[320px] h-[50px] max-w-full rounded-xl overflow-hidden bg-[#12141a]/60 border border-white/10 shadow-md">
        <iframe
          src="/adsterra-movie-mobile-banner.html?v=1"
          width="320"
          height="50"
          scrolling="no"
          frameBorder="0"
          title="adsterra-movie-mobile-banner"
          loading="lazy"
          style={{ width: '320px', height: '50px', border: 'none', overflow: 'hidden' }}
        />
      </div>
    </div>
  );
};
