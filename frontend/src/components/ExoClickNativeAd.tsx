import { useEffect, useRef, useState } from 'react';
import { BannerAd } from './BannerAd';

interface ExoClickNativeAdProps {
  className?: string;
}

export default function ExoClickNativeAd({ className = '' }: ExoClickNativeAdProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Dynamically ensure ad-provider script exists
    if (!document.querySelector('script[src*="ad-provider.js"]')) {
      const script = document.createElement('script');
      script.async = true;
      script.type = 'application/javascript';
      script.src = 'https://a.magsrv.com/ad-provider.js';
      document.head.appendChild(script);
    }

    const loadAd = () => {
      if (containerRef.current) {
        const ins = document.createElement('ins');
        ins.className = 'eas6a97888e20';
        ins.setAttribute('data-zoneid', '5964558');
        ins.setAttribute('data-ex_av', 'name');
        ins.style.display = 'block';
        ins.style.width = '100%';
        ins.style.minHeight = '100px';
        containerRef.current.appendChild(ins);
      }

      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({ "serve": {} });
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };
    
    const timer = setTimeout(loadAd, 100);

    // Fallback detection: if blocked by adblock or empty after 2s, show internal BannerAd
    const fallbackTimer = setTimeout(() => {
      if (containerRef.current) {
        const ins = containerRef.current.querySelector('ins');
        if (!ins || ins.children.length === 0 || ins.offsetHeight === 0) {
          setShowFallback(true);
        }
      }
    }, 2000);

    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, []);

  if (showFallback) {
    return <BannerAd variant="wide" type="telegram" />;
  }

  return (
    <div ref={containerRef} className={`w-full rounded-xl overflow-hidden min-h-[100px] flex justify-center items-center ${className}`}>
    </div>
  );
}


