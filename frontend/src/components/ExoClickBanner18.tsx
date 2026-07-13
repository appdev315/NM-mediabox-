import { useEffect, useRef } from 'react';

export function ExoClickBanner18() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Determine how many banners to show based on screen width (max 2)
    const width = window.innerWidth;
    let count = 1;
    if (width >= 720) {
      count = 2;
    }

    const loadAd = () => {
      if (containerRef.current) {
        let html = '<div class="flex justify-center items-center gap-4 sm:gap-6 w-full flex-wrap">';
        for (let i = 0; i < count; i++) {
          html += '<ins class="eas6a97888e2 rounded-lg overflow-hidden" data-zoneid="5965656" data-ex_av="name" style="display:inline-block;width:300px;height:250px;"></ins>';
        }
        html += '</div>';
        containerRef.current.innerHTML = html;
      }

      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({"serve": {}});
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };

    const timer = setTimeout(loadAd, 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div ref={containerRef} className="w-full mb-6">
    </div>
  );
}
