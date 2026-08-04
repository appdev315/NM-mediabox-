import { useEffect, useRef } from 'react';

interface ExoClickNativeAdProps {
  className?: string;
}

export default function ExoClickNativeAd({ className = '' }: ExoClickNativeAdProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const loadAd = () => {
      if (containerRef.current) {
        const ins = document.createElement('ins');
        ins.className = 'eas6a97888e20';
        ins.setAttribute('data-zoneid', '5964558');
        ins.setAttribute('data-ex_av', 'name');
        ins.style.display = 'inline-block';
        ins.style.width = '100%';
        ins.style.minHeight = 'inherit';
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
    
    const timer = setTimeout(loadAd, 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div ref={containerRef} className={`w-full rounded-xl overflow-hidden ${className}`}>
    </div>
  );
}

