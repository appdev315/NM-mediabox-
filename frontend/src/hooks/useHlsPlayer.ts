import { useRef, useEffect, useCallback } from 'react';
import type Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';

export interface SetupHlsOptions {
  url: string;
  media: HTMLMediaElement | null;
  config?: Partial<HlsConfig>;
  onManifestParsed?: (hls: Hls) => void;
  onError?: (hls: Hls, data: any) => void;
}

export function useHlsPlayer() {
  const hlsRef = useRef<Hls | null>(null);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch (e) {
        console.warn('[HLS] Error destroying instance:', e);
      }
      hlsRef.current = null;
    }
  }, []);

  const initHls = useCallback(async ({
    url,
    media,
    config,
    onManifestParsed,
    onError,
  }: SetupHlsOptions): Promise<Hls | null> => {
    destroyHls();
    if (!media) return null;

    try {
      const { default: HlsClass } = await import('hls.js');
      if (!HlsClass.isSupported()) return null;

      const hls = new HlsClass({
        enableWorker: true,
        lowLatencyMode: false,
        ...config,
      });

      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(media);

      if (onManifestParsed) {
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => onManifestParsed(hls));
      }

      hls.on(HlsClass.Events.ERROR, (_event, data) => {
        if (onError) {
          onError(hls, data);
        } else if (data.fatal) {
          switch (data.type) {
            case HlsClass.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case HlsClass.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              destroyHls();
              break;
          }
        }
      });

      return hls;
    } catch (err) {
      console.error('[HLS] Initialization failed:', err);
      return null;
    }
  }, [destroyHls]);

  useEffect(() => {
    return () => {
      destroyHls();
    };
  }, [destroyHls]);

  return { hlsRef, initHls, destroyHls };
}
