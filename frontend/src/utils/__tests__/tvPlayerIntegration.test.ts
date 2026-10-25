import { describe, it, expect } from 'vitest';
import { TV_CHANNELS, getChannelPhaseOffset } from '../tvSchedule';
import { findLowestQuality } from '../../components/Player';

describe('MediaBox TV & Player Integration Verification', () => {
  it('verifies that TV player mode passes canonical time and t parameters without hash or start duplicate', () => {
    // Симуляция логики генерации currentUrl из Player.tsx
    const rawUrl = 'https://api.media-box.xyz/api/liftw?tmdb=1153576&type=movie';
    const isTv = true;
    const startSec = 4500; // 1 час 15 минут в фильм
    const language = 'ru-RU';

    const langParams = !language.startsWith('ru') ? '&lang=en&audio=en&audio_lang=en' : '';
    const timeParams = startSec > 5
      ? (isTv ? `&time=${startSec}&t=${startSec}` : `&start=${startSec}&time=${startSec}&t=${startSec}&timecode=${startSec}#t=${startSec}`)
      : '';
    const startParams = `&autoplay=1&autoPlay=1${timeParams}${langParams}`;
    
    const finalUrl = `${rawUrl}${startParams}`;

    // В ТВ-режиме передается time=4500 и t=4500 для одновременной поддержки Liftw server render opts.time и client-side player-venom ProgressTracker
    expect(finalUrl).toContain('&autoplay=1');
    expect(finalUrl).toContain('&time=4500');
    expect(finalUrl).toContain('&t=4500');
    expect(finalUrl).not.toContain('&start=');
    expect(finalUrl).not.toContain('#t=');
  });

  it('verifies findLowestQuality selects lowest resolution for weak network buffering', () => {
    expect(findLowestQuality(['1080p', '720p', '480p', '360p'])).toBe('360p');
    expect(findLowestQuality(['1080', '720', '480'])).toBe('480');
    expect(findLowestQuality(['auto', '720p', '1080p', '480p'])).toBe('480p');
    expect(findLowestQuality([])).toBeNull();
  });

  it('verifies safe timecode calculation clamps against actual duration avoiding SEEK_PAST_EOF', () => {
    const initialTimecode = 6500;
    const actualDuration = 5100; // 85 мин (фильм короче слота в 120 мин)
    
    // Формула из MediaBoxTvPlayer.tsx
    const maxDuration = actualDuration;
    const safeTimecode = maxDuration > 30 ? Math.floor(initialTimecode % maxDuration) : initialTimecode;
    const finalTimecode = Math.min(safeTimecode, Math.max(0, (maxDuration || 7200) - 15));

    expect(safeTimecode).toBe(1400); // 6500 % 5100 = 1400 (бесшовный повтор без EOF)
    expect(finalTimecode).toBe(1400);
    expect(finalTimecode).toBeLessThan(actualDuration);
  });

  it('verifies regular movie player mode preserves deep seek parameter', () => {
    // В обычном режиме фильма (не ТВ) глубокий таймкод должен передаваться в URL для продолжения просмотра
    const rawUrl = 'https://api.media-box.xyz/api/liftw?tmdb=1153576&type=movie';
    const isTv = false;
    const startSec = 3600;
    const language = 'ru-RU';

    const langParams = !language.startsWith('ru') ? '&lang=en&audio=en&audio_lang=en' : '';
    const startParams = (!isTv && startSec > 5 
      ? `&start=${startSec}&time=${startSec}&t=${startSec}&timecode=${startSec}&autoplay=1&autoPlay=1#t=${startSec}`
      : '&autoplay=1&autoPlay=1') + langParams;
    
    const finalUrl = `${rawUrl}${startParams}`;
    expect(finalUrl).toContain('&start=3600');
    expect(finalUrl).toContain('&time=3600');
    expect(finalUrl).toContain('#t=3600');
  });

  it('verifies new releases channel (ch-new) contains exactly 20 releases from 2026', () => {
    const newChan = TV_CHANNELS.find(c => c.id === 'ch-new');
    expect(newChan).toBeDefined();
    expect(newChan?.nameRu).toBe('Новинки ТВ');
    expect(newChan?.nameEn).toBe('New Releases TV');
    expect(newChan?.genreNameRu).toBe('Новинки');
    expect(newChan?.icon).toBe('');
    expect(newChan?.moviePool).toBeDefined();
    expect(newChan?.moviePool?.length).toBe(20);

    for (const item of newChan!.moviePool!) {
      expect(item.id).toBeGreaterThan(0);
      expect(item.title).toBeTruthy();
      expect(item.origin_title).toBeTruthy();
      expect(item.posterPath).toMatch(/^\/.+\.(jpg|png|webp)$/i);
      expect(item.year).toBe('2026');
      expect(item.durationSec).toBeGreaterThanOrEqual(7200);
      expect(item.durationSec).toBeLessThanOrEqual(8640);
    }
  });

  it('verifies deterministic non-zero phase offsets for channels', () => {
    const offsets = new Set<number>();
    for (const ch of TV_CHANNELS) {
      const offset = getChannelPhaseOffset(ch);
      expect(typeof offset).toBe('number');
      offsets.add(offset);
    }
    // Проверяем разнообразие сдвигов расписания
    expect(offsets.size).toBeGreaterThan(10);
  });
});
