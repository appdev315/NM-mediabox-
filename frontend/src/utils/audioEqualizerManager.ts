/**
 * Audio Equalizer & 3D Spatial Audio Engine
 * Uses Web Audio API (BiquadFilterNode, Mid-Side Spatial Matrix, DynamicsCompressorNode)
 * to provide studio-grade sound enhancement, wide 3D soundstage, and bass boost.
 */

export interface EqualizerSettings {
  enabled: boolean;
  preset: string; // 'spatial' | 'bass' | 'vocal' | 'rock' | 'edm' | 'hiphop' | 'acoustic' | 'treble' | 'flat' | 'custom'
  bands: [number, number, number, number, number]; // [60Hz, 230Hz, 910Hz, 4000Hz, 14000Hz] in dB (-12 to +12)
  spatialWidth: number; // 0 to 100 (%)
  bassBoost: number; // 0 to 12 (dB)
}

export const EQUALIZER_BANDS = [
  { freq: 60, label: '60 Hz', sub: 'Sub-Bass' },
  { freq: 230, label: '230 Hz', sub: 'Bass' },
  { freq: 910, label: '910 Hz', sub: 'Mid' },
  { freq: 4000, label: '4 kHz', sub: 'Clarity' },
  { freq: 14000, label: '14 kHz', sub: 'Air' }
] as const;

export const EQUALIZER_PRESETS: Record<string, {
  nameKey: string;
  icon: string;
  bands: [number, number, number, number, number];
  spatialWidth: number;
  bassBoost: number;
}> = {
  spatial: { nameKey: 'eq_surround', icon: '🌌', bands: [3, 1, -1, 3, 5], spatialWidth: 80, bassBoost: 3 },
  bass: { nameKey: 'eq_bass', icon: '🔥', bands: [6, 4, -1, 1, 2], spatialWidth: 35, bassBoost: 6 },
  vocal: { nameKey: 'eq_vocal', icon: '🎙', bands: [-2, 1, 4, 3, 1], spatialWidth: 20, bassBoost: 0 },
  rock: { nameKey: 'eq_rock', icon: '🎸', bands: [5, 3, -2, 4, 4], spatialWidth: 40, bassBoost: 2 },
  edm: { nameKey: 'eq_edm', icon: '⚡️', bands: [7, 5, 0, 3, 6], spatialWidth: 60, bassBoost: 5 },
  hiphop: { nameKey: 'eq_hiphop', icon: '🎤', bands: [8, 4, -1, 2, 3], spatialWidth: 40, bassBoost: 6 },
  acoustic: { nameKey: 'eq_acoustic', icon: '🎧', bands: [3, 2, 1, 3, 4], spatialWidth: 50, bassBoost: 1 },
  treble: { nameKey: 'eq_treble', icon: '✨', bands: [-2, 0, 1, 5, 7], spatialWidth: 25, bassBoost: 0 },
  flat: { nameKey: 'eq_flat', icon: '⚖️', bands: [0, 0, 0, 0, 0], spatialWidth: 0, bassBoost: 0 }
};

const STORAGE_KEY = 'mb_equalizer_settings_v2';

const DEFAULT_SETTINGS: EqualizerSettings = {
  enabled: true,
  preset: 'spatial',
  bands: [3, 1, -1, 3, 5],
  spatialWidth: 80,
  bassBoost: 3
};

class AudioEqualizerManager {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private attachedElement: HTMLAudioElement | null = null;
  private filters: BiquadFilterNode[] = [];
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;

  // Mid-Side Spatial Matrix Nodes
  private splitter: ChannelSplitterNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private gainLL: GainNode | null = null;
  private gainLR: GainNode | null = null;
  private gainRL: GainNode | null = null;
  private gainRR: GainNode | null = null;

  private settings: EqualizerSettings = DEFAULT_SETTINGS;
  private listeners: Set<(settings: EqualizerSettings) => void> = new Set();

  constructor() {
    this.loadSettings();

    if (typeof window !== 'undefined') {
      try {
        if ('audioSession' in navigator) {
          (navigator as any).audioSession.type = 'playback';
        }
      } catch (_) {}

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.resumeContext();
        }
      });
    }
  }

  private loadSettings() {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.bands) && parsed.bands.length === 5) {
          this.settings = { ...DEFAULT_SETTINGS, ...parsed };
        }
      }
    } catch (_) {}
  }

  private saveSettings() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (_) {}
    this.notifyListeners();
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener({ ...this.settings });
      } catch (_) {}
    }
  }

  public subscribe(listener: (settings: EqualizerSettings) => void): () => void {
    this.listeners.add(listener);
    listener({ ...this.settings });
    return () => this.listeners.delete(listener);
  }

  public getSettings(): EqualizerSettings {
    return { ...this.settings };
  }

  /**
   * Initializes Web Audio Context and wires the audio element through
   * the filter bank, M/S spatial matrix, and dynamics compressor.
   */
  public attachAudioElement(audio: HTMLAudioElement) {
    if (this.attachedElement === audio && this.sourceNode) {
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }

      const ctx = this.audioContext;

      // createMediaElementSource can only be called once per HTMLAudioElement
      if (!this.sourceNode || this.attachedElement !== audio) {
        this.sourceNode = ctx.createMediaElementSource(audio);
        this.attachedElement = audio;
      }

      // Build 5-band filter bank
      this.filters = EQUALIZER_BANDS.map((band, idx) => {
        const filter = ctx.createBiquadFilter();
        if (idx === 0) {
          filter.type = 'lowshelf';
        } else if (idx === EQUALIZER_BANDS.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.0;
        }
        filter.frequency.value = band.freq;
        filter.gain.value = 0;
        return filter;
      });

      // Chain filters sequentially
      for (let i = 0; i < this.filters.length - 1; i++) {
        this.filters[i].connect(this.filters[i + 1]);
      }

      // Mid-Side 3D Spatial Matrix
      this.splitter = ctx.createChannelSplitter(2);
      this.merger = ctx.createChannelMerger(2);
      this.gainLL = ctx.createGain();
      this.gainLR = ctx.createGain();
      this.gainRL = ctx.createGain();
      this.gainRR = ctx.createGain();

      this.splitter.connect(this.gainLL, 0);
      this.splitter.connect(this.gainRL, 0);
      this.splitter.connect(this.gainLR, 1);
      this.splitter.connect(this.gainRR, 1);

      this.gainLL.connect(this.merger, 0, 0);
      this.gainLR.connect(this.merger, 0, 0);
      this.gainRL.connect(this.merger, 0, 1);
      this.gainRR.connect(this.merger, 0, 1);

      // Dynamics Compressor (Studio glue / peak limiter)
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.knee.value = 24;
      this.compressor.ratio.value = 3;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;

      // Master output gain
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 1.0;

      // Connect complete graph:
      // source -> filter[0]...filter[4] -> splitter -> [MS Matrix] -> merger -> compressor -> masterGain -> destination
      this.sourceNode.connect(this.filters[0]);
      this.filters[this.filters.length - 1].connect(this.splitter);
      this.merger.connect(this.compressor);
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);

      // Apply initial settings
      this.applyParameters();
    } catch (err) {
      console.warn('[AudioEqualizer] Failed to attach audio element:', err);
    }
  }

  /**
   * Resumes AudioContext on user interaction if suspended by browser autoplay policy
   */
  public async resumeContext() {
    if (this.audioContext && this.audioContext.state !== 'running') {
      try {
        await this.audioContext.resume();
      } catch (_) {}
    }
  }

  private applyParameters() {
    if (!this.audioContext) return;

    const { enabled, bands, spatialWidth, bassBoost } = this.settings;

    if (!enabled) {
      // Bypass mode: flatten all filters, normal stereo width, transparent limiter
      this.filters.forEach(f => { f.gain.value = 0; });
      if (this.gainLL && this.gainLR && this.gainRL && this.gainRR) {
        this.gainLL.gain.value = 1.0;
        this.gainLR.gain.value = 0.0;
        this.gainRL.gain.value = 0.0;
        this.gainRR.gain.value = 1.0;
      }
      if (this.compressor) {
        this.compressor.threshold.value = 0;
      }
      return;
    }

    // 1. Apply EQ band gains + Bass Boost
    if (this.filters.length === 5) {
      this.filters[0].gain.value = bands[0] + bassBoost;
      this.filters[1].gain.value = bands[1] + (bassBoost * 0.35);
      this.filters[2].gain.value = bands[2];
      this.filters[3].gain.value = bands[3];
      this.filters[4].gain.value = bands[4];
    }

    // 2. Apply Mid-Side 3D Spatial Audio width
    // spatialWidth 0% => w = 1.0 (standard stereo)
    // spatialWidth 100% => w = 1.85 (expansive 3D soundstage)
    const w = 1.0 + (spatialWidth / 100) * 0.85;
    if (this.gainLL && this.gainLR && this.gainRL && this.gainRR) {
      this.gainLL.gain.value = 0.5 * (1 + w);
      this.gainLR.gain.value = 0.5 * (1 - w);
      this.gainRL.gain.value = 0.5 * (1 - w);
      this.gainRR.gain.value = 0.5 * (1 + w);
    }

    // 3. Compressor
    if (this.compressor) {
      this.compressor.threshold.value = -16;
    }
  }

  public setEnabled(enabled: boolean) {
    this.settings.enabled = enabled;
    this.applyParameters();
    this.saveSettings();
  }

  public setPreset(presetKey: string) {
    const preset = EQUALIZER_PRESETS[presetKey];
    if (!preset) return;

    this.settings.preset = presetKey;
    this.settings.bands = [...preset.bands];
    this.settings.spatialWidth = preset.spatialWidth;
    this.settings.bassBoost = preset.bassBoost;
    this.settings.enabled = true;

    this.applyParameters();
    this.saveSettings();
  }

  public setBand(index: number, gainDb: number) {
    if (index < 0 || index >= 5) return;
    const clamped = Math.max(-12, Math.min(12, gainDb));
    this.settings.bands[index] = clamped;
    this.settings.preset = 'custom';
    this.applyParameters();
    this.saveSettings();
  }

  public setSpatialWidth(percent: number) {
    const clamped = Math.max(0, Math.min(100, percent));
    this.settings.spatialWidth = clamped;
    this.settings.preset = 'custom';
    this.applyParameters();
    this.saveSettings();
  }

  public setBassBoost(db: number) {
    const clamped = Math.max(0, Math.min(12, db));
    this.settings.bassBoost = clamped;
    this.settings.preset = 'custom';
    this.applyParameters();
    this.saveSettings();
  }

  public reset() {
    this.setPreset('flat');
  }
}

export const audioEqualizerManager = new AudioEqualizerManager();
