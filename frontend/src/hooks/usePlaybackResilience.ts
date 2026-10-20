import { useEffect, useCallback, useState, useRef } from 'react';
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

  // Живая позиция — только в ref: setState из timeupdate донорского плеера
  // рендерил бы всю страницу 2-4 раза в секунду.
  const savedTimecodeRef = useRef<number | null>(getSavedTimecode(mediaId));

  // Снимок для рендера (запрос стрима, initialTimecode плеера).
  const [savedTimecode, setSavedTimecode] = useState<number | null>(() => getSavedTimecode(mediaId));
  const [syncedMediaId, setSyncedMediaId] = useState(mediaId);
  if (mediaId !== syncedMediaId) {
    // Канонический паттерн React «adjust state during render»: значение гарантированно
    // актуально уже в первом рендере после смены эпизода/фильма, без устаревшего окна.
    setSyncedMediaId(mediaId);
    const fresh = getSavedTimecode(mediaId);
    savedTimecodeRef.current = fresh;
    setSavedTimecode(fresh);
  }

  const saveTimecode = useCallback((id: string | number, currentTime: number) => {
    if (!id || currentTime <= 0) return;
    const cacheKey = `${TIME_SAVER_PREFIX}${id}`;
    clientCache.set(cacheKey, { timecode: currentTime, savedAt: Date.now() }, 604800); // 7 days TTL
    savedTimecodeRef.current = currentTime;
  }, []);

  // Save current playback position automatically on unexpected offline event
  const onReconnectRef = useRef(onReconnect);
  useEffect(() => { onReconnectRef.current = onReconnect; });

  useEffect(() => {
    if (!mediaId) return;
    if (!isOnline) {
      console.warn(`[PlaybackResilience] Connection lost for media ${mediaId}. Saved position:`, savedTimecodeRef.current);
    } else {
      const restored = getSavedTimecode(mediaId);
      if (restored && restored > 0) {
        onReconnectRef.current?.(restored);
      }
    }
  }, [isOnline, mediaId, getSavedTimecode]);

  return {
    savedTimecode,
    saveTimecode,
  };
}
