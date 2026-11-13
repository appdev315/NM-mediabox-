import { describe, it, expect, vi, afterEach } from 'vitest';
import { clampSeekPosition, seekAfterLoadedMetadata } from '../audioPlaybackRecovery';

describe('audioPlaybackRecovery', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clamps a finite duration and leaves unknown duration untouched', () => {
    expect(clampSeekPosition(120, 100)).toBe(99.75);
    expect(clampSeekPosition(10, 100)).toBe(10);
    expect(clampSeekPosition(0, 100)).toBe(0);
    expect(clampSeekPosition(40, Number.NaN)).toBe(40);
    expect(clampSeekPosition(40, Number.POSITIVE_INFINITY)).toBe(40);
    expect(clampSeekPosition(Number.NaN, 100)).toBe(0);
  });

  it('seeks on loadedmetadata and cancels the previous listener', () => {
    vi.useFakeTimers();
    const audio = new EventTarget() as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 200, writable: true });
    let currentTime = 0;
    Object.defineProperty(audio, 'currentTime', {
      get: () => currentTime,
      set: (value: number) => { currentTime = value; }
    });

    const first = seekAfterLoadedMetadata(audio, 50, 1500);
    first.cancel();
    const second = seekAfterLoadedMetadata(audio, 80, 1500);

    audio.dispatchEvent(new Event('loadedmetadata'));

    expect(currentTime).toBe(80);
    second.cancel();
  });

  it('does not seek forever when metadata never arrives', async () => {
    vi.useFakeTimers();
    const audio = new EventTarget() as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: Number.NaN });
    const writes: number[] = [];
    Object.defineProperty(audio, 'currentTime', {
      get: () => 0,
      set: (value: number) => { writes.push(value); }
    });

    const handle = seekAfterLoadedMetadata(audio, 30, 1500);
    await vi.advanceTimersByTimeAsync(1500);
    await handle.done;

    expect(writes).toEqual([30]);
    handle.cancel();
  });
});
