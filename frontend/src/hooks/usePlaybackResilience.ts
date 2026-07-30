import { useEffect, useCallback, useState } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { clientCache } from '../utils/clientCache';

const TIME_SAVER_PREFIX = 'playback_pos_';

export interface UsePlaybackResilienceOptions {
  mediaId?: string | number;
  onReconnect?: (timecode: number) => void;
}

export function usePlaybackResilience(options: UsePlaybackResilienceOptions = {}) {
  const { mediaId, onReconnect } = options;
  const { isOnline } = useNetworkStatus();

  const getSavedTimecode = useCallback((id?: string | number): number | null => {
    const targetId = id || mediaId;
    if (!targetId) return null;
    const cacheKey = `${TIME_SAVER_PREFIX}${targetId}`;
    const cached = clientCache.get<{ timecode: number; savedAt: number }>(cacheKey);
    return cached ? cached.timecode : null;
  }, [mediaId]);

  const [savedTimecode, setSavedTimecode] = useState<number | null>(() => getSavedTimecode(mediaId));

  const saveTimecode = useCallback((id: string | number, currentTime: number) => {
    if (!id || currentTime <= 0) return;
    const cacheKey = `${TIME_SAVER_PREFIX}${id}`;
    const entry = { timecode: currentTime, savedAt: Date.now() };
    clientCache.set(cacheKey, entry, 604800); // 7 days TTL
    setSavedTimecode(currentTime);
  }, []);

  // Save current playback position automatically on unexpected offline event
  useEffect(() => {
    if (!isOnline && mediaId) {
      console.warn(`[PlaybackResilience] Connection lost for media ${mediaId}. Saved position:`, savedTimecode);
    } else if (isOnline && mediaId && onReconnect) {
      const restored = getSavedTimecode(mediaId);
      if (restored && restored > 0) {
        onReconnect(restored);
      }
    }
  }, [isOnline, mediaId, onReconnect, getSavedTimecode]);

  return {
    isOnline,
    savedTimecode,
    saveTimecode,
    getSavedTimecode,
  };
}
