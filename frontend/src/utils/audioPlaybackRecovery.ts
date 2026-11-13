const SEEK_METADATA_TIMEOUT_MS = 1500;

export function clampSeekPosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return position;
  return Math.min(position, Math.max(0, duration - 0.25));
}

export interface SeekHandle {
  cancel: () => void;
  done: Promise<void>;
}

/**
 * Seek after load(). The listener is attached before load() because a cached
 * resource can fire loadedmetadata synchronously inside load().
 */
export function seekAfterLoadedMetadata(
  audio: HTMLAudioElement,
  targetPos: number,
  timeoutMs = SEEK_METADATA_TIMEOUT_MS
): SeekHandle {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onMeta: (() => void) | null = null;

  const finish = () => {
    if (settled) return;
    settled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (onMeta) {
      audio.removeEventListener('loadedmetadata', onMeta);
      onMeta = null;
    }
  };

  const apply = () => {
    if (settled) return;
    const pos = clampSeekPosition(targetPos, audio.duration);
    if (pos > 0) {
      try { audio.currentTime = pos; } catch { /* duration not usable yet */ }
    }
    finish();
  };

  const done = new Promise<void>((resolve) => {
    const complete = () => {
      apply();
      resolve();
    };

    if (!Number.isFinite(targetPos) || targetPos <= 0 || audio.readyState >= 1) {
      complete();
      return;
    }

    onMeta = () => complete();
    audio.addEventListener('loadedmetadata', onMeta);

    timer = setTimeout(complete, timeoutMs);
  });

  return {
    cancel: finish,
    done
  };
}
