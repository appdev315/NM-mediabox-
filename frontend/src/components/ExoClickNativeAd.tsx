import { useEffect, useRef } from 'react';

export default function ExoClickNativeAd() {
  const adRef = useRef<HTMLModElement>(null);

  useEffect(() => {
    // Load the main provider script if it's not already loaded
    if (!document.querySelector('script[src="https://a.magsrv.com/ad-provider.js"]')) {
      const script = document.createElement('script');
      script.src = 'https://a.magsrv.com/ad-provider.js';
      script.async = true;
      script.type = 'application/javascript';
      document.head.appendChild(script);
    }

    // Run the ad push command
    try {
      // @ts-ignore
      window.AdProvider = window.AdProvider || [];
      // @ts-ignore
      window.AdProvider.push({ "serve": {} });
    } catch (e) {
      console.error('ExoClick Ad Error:', e);
    }
  }, []);

  return (
    <div className="col-span-full w-full my-2">
      <ins 
        ref={adRef}
        className="eas6a97888e20" 
        data-zoneid="5964558"
        style={{ display: 'block', width: '100%' }}
      ></ins>
    </div>
  );
}
