import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import {
  audioEqualizerManager,
  EQUALIZER_BANDS,
  EQUALIZER_PRESETS,
  type EqualizerSettings
} from '../utils/audioEqualizerManager';
import { WebApp } from '../telegram';

interface EqualizerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EqualizerModal: React.FC<EqualizerModalProps> = ({ isOpen, onClose }) => {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<EqualizerSettings>(() => audioEqualizerManager.getSettings());

  useEffect(() => {
    return audioEqualizerManager.subscribe(setSettings);
  }, []);

  if (!isOpen) return null;

  const handleToggle = () => {
    try {
      WebApp?.HapticFeedback?.impactOccurred('light');
    } catch (_) {}
    audioEqualizerManager.setEnabled(!settings.enabled);
  };

  const handlePresetSelect = (key: string) => {
    try {
      WebApp?.HapticFeedback?.selectionChanged();
    } catch (_) {}
    audioEqualizerManager.setPreset(key);
  };

  const handleBandChange = (index: number, val: number) => {
    audioEqualizerManager.setBand(index, val);
  };

  const handleSpatialChange = (val: number) => {
    audioEqualizerManager.setSpatialWidth(val);
  };

  const handleBassBoostChange = (val: number) => {
    audioEqualizerManager.setBassBoost(val);
  };

  const handleReset = () => {
    try {
      WebApp?.HapticFeedback?.notificationOccurred('warning');
    } catch (_) {}
    audioEqualizerManager.reset();
  };

  return (
    <div 
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-md transition-opacity animate-in fade-in"
      onClick={onClose}
    >
      <div 
        className="w-full sm:max-w-md max-w-[calc(100vw-32px)] bg-[#161618]/95 border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 text-white max-h-[90vh] overflow-y-auto overflow-x-hidden no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-1 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🎚️</span>
            <div>
              <h2 className="text-base font-extrabold tracking-tight">{t('equalizer')}</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Toggle switch */}
            <button
              onClick={handleToggle}
              className={`px-3 py-1 rounded-full text-xs font-black transition-all border ${
                settings.enabled
                  ? 'bg-[#FA2D48] text-white border-[#FA2D48] shadow-md shadow-[#FA2D48]/30'
                  : 'bg-white/10 text-white/50 border-white/10'
              }`}
            >
              {settings.enabled ? t('eq_enabled') : (t('eq_disabled') || 'Выкл')}
            </button>

            {/* Close */}
            <button 
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs font-bold text-white/70 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Presets Horizontal Pills */}
        <div className="flex flex-col gap-1.5 min-w-0 max-w-full">
          <div className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
            {t('eq_preset')}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar min-w-0 max-w-full">
            {Object.entries(EQUALIZER_PRESETS).map(([key, p]) => {
              const isSelected = settings.preset === key;
              return (
                <button
                  key={key}
                  onClick={() => handlePresetSelect(key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border flex items-center gap-1.5 shrink-0 ${
                    isSelected
                      ? 'bg-white text-black border-white shadow-md'
                      : 'bg-white/5 hover:bg-white/10 text-white/70 border-white/10'
                  }`}
                >
                  <span>{p.icon}</span>
                  <span>{t(p.nameKey as any) || key}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3D Spatial Audio & Bass Boost Sliders */}
        <div className="grid grid-cols-2 gap-3 p-3 bg-white/5 rounded-2xl border border-white/5 min-w-0">
          {/* 3D Spatial */}
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold flex items-center gap-1 truncate">
                <span>🌌</span>
                <span className="truncate">{t('eq_spatial_3d')}</span>
              </span>
              <span className="font-mono text-white/60 text-[11px]">{settings.spatialWidth}%</span>
            </div>
            <input 
              type="range"
              min="0"
              max="100"
              step="5"
              value={settings.spatialWidth}
              onChange={(e) => handleSpatialChange(Number(e.target.value))}
              className="w-full accent-[#FA2D48] h-1.5 bg-white/20 rounded-lg cursor-pointer"
            />
          </div>

          {/* Bass Boost */}
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold flex items-center gap-1 truncate">
                <span>🔥</span>
                <span className="truncate">{t('eq_bass_boost')}</span>
              </span>
              <span className="font-mono text-white/60 text-[11px]">+{settings.bassBoost} dB</span>
            </div>
            <input 
              type="range"
              min="0"
              max="12"
              step="1"
              value={settings.bassBoost}
              onChange={(e) => handleBassBoostChange(Number(e.target.value))}
              className="w-full accent-[#FA2D48] h-1.5 bg-white/20 rounded-lg cursor-pointer"
            />
          </div>
        </div>

        {/* 5-Band Equalizer Vertical Sliders */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex justify-between items-center text-[11px] font-bold text-white/50 uppercase tracking-wider">
            <span>{t('eq_frequencies') || 'Частоты'}</span>
            <span>-12 dB ... +12 dB</span>
          </div>

          <div className="grid grid-cols-5 gap-1.5 p-3 bg-white/5 rounded-2xl border border-white/5 min-w-0 overflow-hidden">
            {EQUALIZER_BANDS.map((band, idx) => {
              const currentVal = settings.bands[idx] ?? 0;
              return (
                <div key={band.freq} className="flex flex-col items-center gap-2 min-w-0">
                  <span className="text-[10px] font-mono text-white/60">
                    {currentVal > 0 ? `+${currentVal}` : currentVal}
                  </span>

                  <div className="relative h-28 w-8 flex items-center justify-center overflow-visible">
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={currentVal}
                      onChange={(e) => handleBandChange(idx, Number(e.target.value))}
                      className="accent-[#FA2D48] w-24 h-1.5 bg-white/20 rounded-lg cursor-pointer -rotate-90 origin-center"
                    />
                  </div>

                  <div className="text-center mt-1 w-full">
                    <div className="text-xs font-bold text-white/90 truncate">{band.label}</div>
                    <div className="text-[9px] text-white/40 truncate">{band.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer controls */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-bold text-white/70 hover:text-white border border-white/10 transition-colors"
          >
            {t('eq_reset')}
          </button>

          <button
            onClick={onClose}
            className="px-5 py-1.5 rounded-full bg-white text-black text-xs font-black shadow-md hover:bg-white/90 active:scale-95 transition-transform"
          >
            {t('gotIt') || 'Готово'}
          </button>
        </div>
      </div>
    </div>
  );
};
