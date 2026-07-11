import { useEffect, useRef, useState } from 'react';
import { WebApp } from '../telegram';
import NoSleep from 'nosleep.js';

interface PlayerProps {
  iframeUrl: string;
}

export function Player({ iframeUrl }: PlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isXvideos = iframeUrl.includes('xvideos.com');

  useEffect(() => {
    WebApp.expand();
    WebApp.enableClosingConfirmation();
    
    // Attempt to request true fullscreen if supported by the client (Bot API 8.0+)
    // Only do this on mobile platforms, as it's annoying on desktop/web
    const platform = WebApp.platform || 'unknown';
    const isMobile = ['android', 'android_x', 'ios'].includes(platform);
    
    if (isMobile && WebApp.requestFullscreen) {
      WebApp.requestFullscreen();
    }

    // Request screen wake lock to prevent screen from turning off/dimming during playback
    // We use NoSleep.js which creates a hidden playing video as a robust fallback to prevent dimming
    const noSleep = new NoSleep();
    
    const enableNoSleep = () => {
      if (!noSleep.isEnabled) {
        noSleep.enable().catch(err => {
          console.error(`NoSleep enable error:`, err);
        });
      }
    };

    // Try to enable immediately (might work if there's a recent user gesture from navigation)
    enableNoSleep();

    // Also try to enable on any interaction with the parent window (if they click outside iframe)
    document.addEventListener('click', enableNoSleep);
    document.addEventListener('touchstart', enableNoSleep);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        enableNoSleep();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleFullscreenChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      noSleep.disable();
      document.removeEventListener('click', enableNoSleep);
      document.removeEventListener('touchstart', enableNoSleep);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      WebApp.disableClosingConfirmation();
      if (isMobile && WebApp.exitFullscreen) {
        WebApp.exitFullscreen();
      }
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    const el = wrapperRef.current as any;
    if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
      if (el?.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el?.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        await (document as any).webkitExitFullscreen();
      }
    }
  };

  const getUrlWithCacheBuster = (url: string) => {
    try {
      const urlObj = new URL(url);
      urlObj.searchParams.set('_t', Date.now().toString());
      return urlObj.toString();
    } catch (e) {
      // If it's not a valid URL (e.g. protocol-relative), just append
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}_t=${Date.now()}`;
    }
  };

  return (
    <div ref={wrapperRef} className="player-wrapper relative overflow-hidden bg-black flex justify-center items-center group/player" style={{ width: '100%', aspectRatio: '16/9' }}>
      <iframe 
        src={getUrlWithCacheBuster(iframeUrl)}
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
      {isXvideos && (
        <button 
          onClick={toggleFullscreen}
          className="absolute top-2 right-2 bg-black/50 hover:bg-black/80 text-white p-2 rounded-lg z-10 transition-colors"
          title="Toggle Fullscreen"
        >
          {isFullscreen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          )}
        </button>
      )}
    </div>
  );
}
