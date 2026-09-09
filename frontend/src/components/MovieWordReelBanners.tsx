import React, { useState, useEffect } from 'react';
import { WebApp } from '../telegram';
import { useLanguage } from '../context/LanguageContext';

interface SingleMovieReelProps {
  id: string;
  targetWord: string;
  icon: string;
  animate: boolean;
  stopDelay: number;
}

const CINEMA_STRIP_WORDS = [
  'CINEMA',
  'PREMIERE',
  'STREAM',
  '4K ULTRA',
  'ONLINE',
  'BLOCKBUSTER',
  'CINEMA',
  'PREMIERE',
  'STREAM',
  '4K ULTRA',
  'ONLINE',
  'BLOCKBUSTER'
];

const SingleMovieReelBanner: React.FC<SingleMovieReelProps> = ({
  id,
  targetWord,
  icon,
  animate,
  stopDelay
}) => {
  const [stopped, setStopped] = useState(!animate);
  const [revealed, setRevealed] = useState(!animate);

  useEffect(() => {
    if (!animate) return;

    const timer = setTimeout(() => {
      setStopped(true);
      try {
        WebApp.HapticFeedback?.impactOccurred('medium');
      } catch (_) {}

      // Reveal banner iframe smoothly after text settling
      const revealTimer = setTimeout(() => {
        setRevealed(true);
      }, 400);

      return () => clearTimeout(revealTimer);
    }, stopDelay);

    return () => clearTimeout(timer);
  }, [animate, stopDelay]);

  return (
    <div
      style={{ width: '300px', height: '250px', maxWidth: '100%', flexShrink: 0 }}
      className={`relative flex justify-center items-center rounded-2xl overflow-hidden shadow-lg bg-[#18181b] border border-blue-500/20 transition-all duration-300 ${
        stopped && animate ? 'word-stopped-bounce border-blue-400/80' : ''
      }`}
    >
      {/* Background Adsterra Iframe (Pre-mounted from t=0 for instant viewability) */}
      <iframe
        src={`/adsterra-movie-banner.html?v=1&slot=${id}`}
        width="300"
        height="250"
        scrolling="no"
        frameBorder="0"
        title={`adsterra-movie-banner-${id}`}
        style={{ width: '300px', height: '250px', border: 'none', overflow: 'hidden' }}
      />

      {/* Cinematic Typography Reel Overlay (Runs 1 time per session) */}
      {!revealed && (
        <div
          className={`absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-b from-[#0f1117] via-[#161922] to-[#0f1117] transition-opacity duration-300 ${
            stopped ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {/* Top/Bottom vignette shadows */}
          <div className="absolute top-0 inset-x-0 h-16 bg-gradient-to-b from-[#0a0c10] via-[#0a0c10]/80 to-transparent z-20 pointer-events-none" />
          <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-[#0a0c10] via-[#0a0c10]/80 to-transparent z-20 pointer-events-none" />

          {/* Central Target Frame */}
          <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 h-20 border border-blue-400/30 rounded-xl bg-blue-500/10 backdrop-blur-[2px] z-10 pointer-events-none flex items-center justify-between px-3">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
          </div>

          {/* Spinning Words Strip */}
          <div className="w-full flex flex-col items-center overflow-hidden h-[250px] justify-center">
            {!stopped ? (
              <div className="flex flex-col items-center word-strip-spinning py-2">
                {CINEMA_STRIP_WORDS.map((word, i) => (
                  <div
                    key={i}
                    className="text-base sm:text-lg font-black tracking-widest my-2 select-none text-blue-300/70 uppercase"
                  >
                    {word}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-1.5 z-20">
                <span className="text-3xl filter drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]">
                  {icon}
                </span>
                <span className="text-xl sm:text-2xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-blue-300 via-white to-blue-300 uppercase filter drop-shadow-[0_0_12px_rgba(59,130,246,0.8)] px-2 text-center">
                  {targetWord}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const MovieWordReelBanners: React.FC = () => {
  const { t } = useLanguage();

  const [animate] = useState(() => {
    if (typeof window === 'undefined') return false;
    const played = sessionStorage.getItem('movie_word_reel_played');
    if (!played) {
      sessionStorage.setItem('movie_word_reel_played', 'true');
      return true;
    }
    return false;
  });

  const reels = [
    {
      id: 'movie-0',
      targetWord: t('adWordMovies') || 'MOVIES',
      icon: '🎬',
      stopDelay: 1000
    },
    {
      id: 'movie-1',
      targetWord: t('adWordSeries') || 'TV SHOWS',
      icon: '📺',
      stopDelay: 1450
    },
    {
      id: 'movie-2',
      targetWord: t('adWordEverywhere') || 'EVERYWHERE',
      icon: '🌍',
      stopDelay: 1900
    }
  ];

  return (
    <div className="w-full flex justify-center items-center gap-4 sm:gap-6 my-4 flex-wrap overflow-hidden min-h-[250px]">
      {reels.map((reel, index) => (
        <div
          key={reel.id}
          className={index > 0 ? 'hidden md:flex justify-center' : 'flex justify-center'}
        >
          <SingleMovieReelBanner
            id={reel.id}
            targetWord={reel.targetWord}
            icon={reel.icon}
            animate={animate}
            stopDelay={reel.stopDelay}
          />
        </div>
      ))}
    </div>
  );
};
