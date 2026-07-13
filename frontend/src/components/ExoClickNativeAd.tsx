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
        containerRef.current.innerHTML = '<ins class="eas6a97888e20" data-zoneid="5964558" data-ex_av="name" style="display:inline-block;width:100%;min-height:250px;"></ins>';
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

