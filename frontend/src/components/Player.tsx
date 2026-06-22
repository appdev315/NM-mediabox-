import { useEffect } from 'react';
import { WebApp } from '../telegram';

interface PlayerProps {
  iframeUrl: string;
}

export function Player({ iframeUrl }: PlayerProps) {
  useEffect(() => {
    WebApp.expand();
    WebApp.enableClosingConfirmation();

    return () => {
      WebApp.disableClosingConfirmation();
    };
  }, []);

  return (
    <div className="player-wrapper" style={{ width: '100%', aspectRatio: '16/9' }}>
      <iframe 
        src={iframeUrl}
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
        style={{ width: '100%', height: '100%', border: 'none' }}
      />
    </div>
  );
}
