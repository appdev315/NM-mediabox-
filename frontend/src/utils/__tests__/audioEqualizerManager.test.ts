import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audioEqualizerManager, EQUALIZER_PRESETS } from '../audioEqualizerManager';

describe('Audio Equalizer Manager (audioEqualizerManager.ts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with default spatial preset', () => {
    const settings = audioEqualizerManager.getSettings();
    expect(settings).toBeDefined();
    expect(settings.bands).toHaveLength(5);
    expect(typeof settings.spatialWidth).toBe('number');
    expect(typeof settings.bassBoost).toBe('number');
  });

  it('should apply presets correctly', () => {
    audioEqualizerManager.setPreset('bass');
    const bassSettings = audioEqualizerManager.getSettings();
    expect(bassSettings.preset).toBe('bass');
    expect(bassSettings.bassBoost).toBe(EQUALIZER_PRESETS.bass.bassBoost);

    audioEqualizerManager.setPreset('vocal');
    const vocalSettings = audioEqualizerManager.getSettings();
    expect(vocalSettings.preset).toBe('vocal');
    expect(vocalSettings.spatialWidth).toBe(EQUALIZER_PRESETS.vocal.spatialWidth);
  });

  it('should safely clamp custom band gains between -12 and +12 dB', () => {
    audioEqualizerManager.setBand(0, 15);
    expect(audioEqualizerManager.getSettings().bands[0]).toBe(12);

    audioEqualizerManager.setBand(0, -25);
    expect(audioEqualizerManager.getSettings().bands[0]).toBe(-12);

    audioEqualizerManager.setBand(2, 4);
    expect(audioEqualizerManager.getSettings().bands[2]).toBe(4);
  });

  it('should safely execute disconnectGraph without throwing', () => {
    expect(() => {
      audioEqualizerManager.disconnectGraph();
    }).not.toThrow();
  });
});
