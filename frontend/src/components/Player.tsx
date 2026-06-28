import { useEffect } from 'react';
import { WebApp } from '../telegram';

interface PlayerProps {
  iframeUrl: string;
}

export function Player({ iframeUrl }: PlayerProps) {
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

    return () => {
      WebApp.disableClosingConfirmation();
      if (isMobile && WebApp.exitFullscreen) {
        WebApp.exitFullscreen();
      }
    };
  }, []);

  return (
    <div className="player-wrapper overflow-hidden bg-black flex justify-center items-center" style={{ width: '100%', aspectRatio: '16/9' }}>
      <iframe 
        src={iframeUrl}
        allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
}
