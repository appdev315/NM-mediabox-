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
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md transition-opacity animate-in fade-in"
      onClick={onClose}
    >
      <div 
        className="w-full sm:max-w-md max-w-[calc(100vw-32px)] border rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl backdrop-blur-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto overflow-x-hidden no-scrollbar"
        style={{
          backgroundColor: 'var(--bg-color)',
          borderColor: 'var(--hint-color, rgba(120, 120, 120, 0.2))',
          color: 'var(--text-color)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-1 border-b" style={{ borderColor: 'var(--hint-color, rgba(120, 120, 120, 0.2))' }}>
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🎚️</span>
            <div>
              <h2 className="text-base font-extrabold tracking-tight" style={{ color: 'var(--text-color)' }}>{t('equalizer')}</h2>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Toggle switch */}
            <button
              onClick={handleToggle}
              className={`px-3 py-1 rounded-full text-xs font-black transition-all border ${
                settings.enabled
                  ? 'bg-[#FA2D48] text-white border-[#FA2D48] shadow-md shadow-[#FA2D48]/30'
                  : 'opacity-50 border'
              }`}
              style={{
                backgroundColor: settings.enabled ? '#FA2D48' : 'var(--hint-color, rgba(120, 120, 120, 0.15))',
                borderColor: settings.enabled ? '#FA2D48' : 'var(--hint-color, rgba(120, 120, 120, 0.25))',
                color: settings.enabled ? '#ffffff' : 'var(--text-color)'
              }}
            >
              {settings.enabled ? t('eq_enabled') : (t('eq_disabled') || 'Выкл')}
            </button>

            {/* Close */}
            <button 
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold opacity-70 hover:opacity-100 transition-opacity cursor-pointer border"
              style={{
                backgroundColor: 'var(--hint-color, rgba(120, 120, 120, 0.15))',
                borderColor: 'var(--hint-color, rgba(120, 120, 120, 0.2))',
                color: 'var(--text-color)'
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Presets Horizontal Pills */}
        <div className="flex flex-col gap-1.5 min-w-0 max-w-full">
          <div className="text-[11px] font-bold uppercase tracking-wider opacity-60" style={{ color: 'var(--text-color)' }}>
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
                      ? 'shadow-md font-black'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: isSelected ? 'var(--button-color, #FA2D48)' : 'var(--hint-color, rgba(120, 120, 120, 0.1))',
                    borderColor: isSelected ? 'var(--button-color, #FA2D48)' : 'var(--hint-color, rgba(120, 120, 120, 0.2))',
                    color: isSelected ? 'var(--button-text-color, #fff)' : 'var(--text-color)'
                  }}
                >
                  <span>{p.icon}</span>
                  <span>{t(p.nameKey as any) || key}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3D Spatial Audio & Bass Boost Sliders */}
        <div 
          className="grid grid-cols-2 gap-3 p-3 rounded-2xl border min-w-0"
          style={{
            backgroundColor: 'var(--hint-color, rgba(120, 120, 120, 0.08))',
            borderColor: 'var(--hint-color, rgba(120, 120, 120, 0.15))'
          }}
        >
          {/* 3D Spatial */}
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold flex items-center gap-1 truncate" style={{ color: 'var(--text-color)' }}>
                <span>🌌</span>
                <span className="truncate">{t('eq_spatial_3d')}</span>
              </span>
              <span className="font-mono opacity-60 text-[11px]" style={{ color: 'var(--text-color)' }}>{settings.spatialWidth}%</span>
            </div>
            <input 
              type="range"
              min="0"
              max="100"
              step="5"
              value={settings.spatialWidth}
              onChange={(e) => handleSpatialChange(Number(e.target.value))}
              className="w-full accent-[#FA2D48] h-1.5 rounded-lg cursor-pointer opacity-90 hover:opacity-100"
              style={{ backgroundColor: 'var(--hint-color, rgba(150, 150, 150, 0.3))' }}
            />
          </div>

          {/* Bass Boost */}
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold flex items-center gap-1 truncate" style={{ color: 'var(--text-color)' }}>
                <span>🔥</span>
                <span className="truncate">{t('eq_bass_boost')}</span>
              </span>
              <span className="font-mono opacity-60 text-[11px]" style={{ color: 'var(--text-color)' }}>+{settings.bassBoost} dB</span>
            </div>
            <input 
              type="range"
              min="0"
              max="12"
              step="1"
              value={settings.bassBoost}
              onChange={(e) => handleBassBoostChange(Number(e.target.value))}
              className="w-full accent-[#FA2D48] h-1.5 rounded-lg cursor-pointer opacity-90 hover:opacity-100"
              style={{ backgroundColor: 'var(--hint-color, rgba(150, 150, 150, 0.3))' }}
            />
          </div>
        </div>

        {/* 5-Band Equalizer Vertical Sliders */}
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex justify-between items-center text-[11px] font-bold uppercase tracking-wider opacity-60" style={{ color: 'var(--text-color)' }}>
            <span>{t('eq_frequencies') || 'Частоты'}</span>
            <span>-12 dB ... +12 dB</span>
          </div>

          <div 
            className="grid grid-cols-5 gap-1.5 p-3 rounded-2xl border min-w-0 overflow-hidden"
            style={{
              backgroundColor: 'var(--hint-color, rgba(120, 120, 120, 0.08))',
              borderColor: 'var(--hint-color, rgba(120, 120, 120, 0.15))'
            }}
          >
            {EQUALIZER_BANDS.map((band, idx) => {
              const currentVal = settings.bands[idx] ?? 0;
              return (
                <div key={band.freq} className="flex flex-col items-center gap-2 min-w-0">
                  <span className="text-[10px] font-mono opacity-60" style={{ color: 'var(--text-color)' }}>
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
                      className="accent-[#FA2D48] w-24 h-1.5 rounded-lg cursor-pointer -rotate-90 origin-center opacity-90 hover:opacity-100"
                      style={{ backgroundColor: 'var(--hint-color, rgba(150, 150, 150, 0.3))' }}
                    />
                  </div>

                  <div className="text-center mt-1 w-full">
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text-color)' }}>{band.label}</div>
                    <div className="text-[9px] opacity-50 truncate" style={{ color: 'var(--text-color)' }}>{band.sub}</div>
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
            className="px-3 py-1.5 rounded-full text-xs font-bold border transition-opacity opacity-70 hover:opacity-100 cursor-pointer"
            style={{
              backgroundColor: 'var(--hint-color, rgba(120, 120, 120, 0.1))',
              borderColor: 'var(--hint-color, rgba(120, 120, 120, 0.2))',
              color: 'var(--text-color)'
            }}
          >
            {t('eq_reset')}
          </button>

          <button
            onClick={onClose}
            className="px-5 py-1.5 rounded-full text-xs font-black shadow-md active:scale-95 transition-transform cursor-pointer"
            style={{
              backgroundColor: 'var(--button-color, #FA2D48)',
              color: 'var(--button-text-color, #fff)'
            }}
          >
            {t('gotIt') || 'Готово'}
          </button>
        </div>
      </div>
    </div>
  );
};
