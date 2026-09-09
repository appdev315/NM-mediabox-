import React, { useState, useEffect } from 'react';
import { WebApp } from '../telegram';

interface SingleBannerProps {
  id: string;
  animate: boolean;
  stopDelay: number;
}

const SLOT_SYMBOLS = ['7️⃣', '🍒', '💎', '🎰', '👑', '🍓', '7️⃣', '🍒', '💎', '🎰', '👑', '🍓'];

const SingleAdsterraBanner: React.FC<SingleBannerProps> = ({ id, animate, stopDelay }) => {
  const [stopped, setStopped] = useState(!animate);
  const [revealed, setRevealed] = useState(!animate);

  useEffect(() => {
    if (!animate) return;

    const timer = setTimeout(() => {
      setStopped(true);
      try {
        WebApp.HapticFeedback?.impactOccurred('medium');
      } catch (_) {}

      // Reveal banner smoothly after bounce
      const revealTimer = setTimeout(() => {
        setRevealed(true);
      }, 350);

      return () => clearTimeout(revealTimer);
    }, stopDelay);

    return () => clearTimeout(timer);
  }, [animate, stopDelay]);

  return (
    <div 
      style={{ width: '300px', height: '250px', maxWidth: '100%', flexShrink: 0 }} 
      className={`relative flex justify-center items-center rounded-2xl overflow-hidden shadow-md bg-[#18181b] border border-amber-500/20 transition-all duration-300 ${stopped && animate ? 'slot-stopped-bounce border-amber-400/80' : ''}`}
    >
      {/* Background Adsterra Iframe (Pre-mounted from t=0 for instant viewability) */}
      <iframe
        src={`/adsterra-banner.html?v=1&slot=${id}`}
        width="300"
        height="250"
        scrolling="no"
        frameBorder="0"
        title={`adsterra-banner-${id}`}
        style={{ width: '300px', height: '250px', border: 'none', overflow: 'hidden' }}
      />

      {/* Slot Machine Overlay (Runs 1 time per session) */}
      {!revealed && (
        <div 
          className={`absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-b from-[#111113] via-[#1c1c22] to-[#111113] transition-opacity duration-300 ${stopped ? 'opacity-0' : 'opacity-100'}`}
        >
          {/* Top/Bottom shadow gradients for cylindrical reel effect */}
          <div className="absolute top-0 inset-x-0 h-14 bg-gradient-to-b from-black via-black/70 to-transparent z-20 pointer-events-none" />
          <div className="absolute bottom-0 inset-x-0 h-14 bg-gradient-to-t from-black via-black/70 to-transparent z-20 pointer-events-none" />

          {/* Central Win Indicator Line */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-16 border-y border-amber-400/40 bg-amber-500/10 z-10 pointer-events-none flex items-center justify-between px-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
          </div>

          {/* Spinning Reel Strip */}
          <div className="w-full flex flex-col items-center overflow-hidden h-[250px] justify-center">
            {!stopped ? (
              <div className="flex flex-col items-center slot-strip-spinning">
                {SLOT_SYMBOLS.map((sym, i) => (
                  <div key={i} className="text-4xl sm:text-5xl my-2 select-none filter drop-shadow-[0_0_8px_rgba(255,215,0,0.5)]">
                    {sym}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-6xl animate-bounce filter drop-shadow-[0_0_15px_rgba(255,215,0,0.9)]">
                🎰
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const AdsterraBanner300x250: React.FC<{ enableSlotAnimation?: boolean }> = ({ enableSlotAnimation = false }) => {
  const [count] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      return 3;
    }
    return 1;
  });

  const [animate] = useState(() => {
    if (!enableSlotAnimation || typeof window === 'undefined') return false;
    const played = sessionStorage.getItem('ad_slot_played');
    if (!played) {
      sessionStorage.setItem('ad_slot_played', 'true');
      return true;
    }
    return false;
  });

  return (
    <div className="w-full flex justify-center items-center gap-4 sm:gap-6 my-3 flex-wrap overflow-hidden min-h-[250px]">
      {Array.from({ length: count }).map((_, idx) => {
        const stopDelay = count === 1 ? 1000 : 700 + idx * 400;
        return (
          <SingleAdsterraBanner 
            key={idx} 
            id={String(idx)} 
            animate={animate} 
            stopDelay={stopDelay} 
          />
        );
      })}
    </div>
  );
};


