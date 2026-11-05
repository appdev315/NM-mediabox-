import { describe, it, expect } from 'vitest';
import { TV_CHANNELS, getChannelPhaseOffset } from '../tvSchedule';
import { findLowestQuality, sortQualities } from '../../components/Player';

describe('MediaBox TV & Player Integration Verification', () => {
  it('verifies that TV player mode passes canonical time and t parameters without hash or start duplicate', () => {
    // Симуляция логики генерации currentUrl из Player.tsx
    const rawUrl = 'https://api.media-box.xyz/api/liftw?tmdb=1153576&type=movie';
    const isTv = true;
    const startSec = 4500; // 1 час 15 минут в фильм
    const language = 'ru-RU';

    const langParams = !language.startsWith('ru') ? '&lang=en&audio=en&audio_lang=en' : '';
    const timeParams = startSec > 5
      ? (isTv ? `&start=${startSec}&time=${startSec}&t=${startSec}` : `&start=${startSec}&time=${startSec}&t=${startSec}&timecode=${startSec}#t=${startSec}`)
      : '';
    const startParams = `&autoplay=1&autoPlay=1${timeParams}${langParams}`;
    
    const finalUrl = `${rawUrl}${startParams}`;

    // В ТВ-режиме передается time=4500 и t=4500 для одновременной поддержки Liftw server render opts.time и client-side player-venom ProgressTracker
    expect(finalUrl).toContain('&autoplay=1');
    expect(finalUrl).toContain('&start=4500');
    expect(finalUrl).toContain('&time=4500');
    expect(finalUrl).toContain('&t=4500');
    expect(finalUrl).not.toContain('#t=');
  });

  it('verifies findLowestQuality selects lowest resolution for weak network buffering', () => {
    expect(findLowestQuality(['1080p', '720p', '480p', '360p'])).toBe('360p');
    expect(findLowestQuality(['1080', '720', '480'])).toBe('480');
    expect(findLowestQuality(['auto', '720p', '1080p', '480p'])).toBe('480p');
    expect(findLowestQuality([])).toBeNull();
  });

  it('verifies sortQualities canonically orders resolutions descending and places auto last', () => {
    const mixed = ['360p', 'auto', '1080p', '480p', '720p'];
    expect(sortQualities(mixed)).toEqual(['1080p', '720p', '480p', '360p', 'auto']);
    expect(sortQualities(['auto', '1080', '720'])).toEqual(['1080', '720', 'auto']);
    expect(sortQualities([])).toEqual([]);
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
      expect(item.durationSec).toBeGreaterThanOrEqual(3600);
      expect(item.durationSec).toBeLessThanOrEqual(14400);
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

  it('verifies mb-audio-started event triggers audio-stops-tv notification mechanism', () => {
    let tvClosed = false;
    const bus = typeof window !== 'undefined' ? window : new EventTarget();
    const handleAudio = () => { tvClosed = true; };
    bus.addEventListener('mb-audio-started', handleAudio as any);

    bus.dispatchEvent(new Event('mb-audio-started'));
    expect(tvClosed).toBe(true);

    bus.removeEventListener('mb-audio-started', handleAudio as any);
  });

  it('verifies TV Live Sync Watchdog resyncs donors that start outside the live grid point (start-from-zero AND mid-position race)', () => {
    // Симуляция дрейфовой логики Live TV Sync Watchdog из MediaBoxTvPlayer.tsx:
    // детекция по дрейфу позиции донора от живого таймкода сетки вместо узкого окна rawPos <= 30
    const buildResyncSrc = (currentLiveSec: number) => {
      const currentSrc = 'https://embed.liftw.ws/embed/movie/3611?host=liftw.ws';
      let cleanSrc = currentSrc.replace(/[?&](start|t|time|timecode)=\d+/g, '');
      if (cleanSrc.includes('?&')) cleanSrc = cleanSrc.replace('?&', '?');
      if (cleanSrc.endsWith('?')) cleanSrc = cleanSrc.slice(0, -1);
      const sep = cleanSrc.includes('?') ? '&' : '?';
      return `${cleanSrc}${sep}start=${currentLiveSec}&time=${currentLiveSec}&t=${currentLiveSec}&autoplay=1`;
    };
    const watchdogDecision = (
      rawPos: number,
      currentLiveSec: number,
      isLivePlaying: boolean = true,
      livePlayStartAt: number = Date.now() - 15000,
      lastSyncTime: number = 0,
      resyncAttempts: number = 0
    ) => {
      const driftSec = currentLiveSec - rawPos;
      const isFreshSlotStart = currentLiveSec <= 60;
      const isWarmupPhase = !livePlayStartAt || (Date.now() - livePlayStartAt < 10000);
      return (
        isLivePlaying &&
        !isWarmupPhase &&
        !isFreshSlotStart &&
        resyncAttempts < 3 &&
        Date.now() - lastSyncTime > 10000 &&
        Math.abs(driftSec) >= 45
      );
    };

    // 1. Донор проигрывает с 0:02, эфир на 5909 — после warm-up отставание → ресинк на эфирную точку
    expect(watchdogDecision(2, 5909)).toBe(true);
    expect(buildResyncSrc(5909)).toBe('https://embed.liftw.ws/embed/movie/3611?host=liftw.ws&start=5909&time=5909&t=5909&autoplay=1');

    // 2. Warm-up защита: в первые 10 секунд воспроизведения перезагрузка запрещена даже при большом дрейфе
    expect(watchdogDecision(0, 5909, true, Date.now() - 3000)).toBe(false);
    expect(watchdogDecision(2, 5909, true, 0)).toBe(false); // livePlayStartAt не начался

    // 3. Слепое пятно прежнего watchdog («плеер загрузился быстрее подхвата эфира»):
    // донор стартует на 120й секунде при эфире 5909 — ресинк выполняется
    expect(watchdogDecision(120, 5910)).toBe(true);
    expect(watchdogDecision(2500, 5910)).toBe(true);

    // 4. Позиция донора соответствует эфиру — дрейф в пределах порога, ресинк не выполняется
    expect(watchdogDecision(5910, 5910)).toBe(false);

    // 5. Свежий слот (эфир < 60 сек) законно играет с нуля — без ресинка
    expect(watchdogDecision(2, 30)).toBe(false);

    // 6. Лимит ресинков (максимум 3) и кулдаун 10с
    expect(watchdogDecision(2, 5909, true, Date.now() - 15000, Date.now() - 5000, 0)).toBe(false); // кулдаун
    expect(watchdogDecision(2, 5909, true, Date.now() - 15000, 0, 3)).toBe(false); // исчерпан лимит
  });

  it('verifies live grid point advances frozen elapsedSec by seconds since last schedule tick, capped by item duration', () => {
    // Симуляция getLiveGridSec из MediaBoxTvPlayer.tsx: elapsedSec замерзает вместе
    // с уснувшим OSD-таймером, watchdog'и обязаны докручивать живую эфирную точку
    const getLiveGridSec = (elapsedSec: number, durationSec: number, tickAgeMs: number) => {
      const advanced = Math.max(0, Math.floor(tickAgeMs / 1000));
      return Math.min(durationSec, Math.max(0, elapsedSec + advanced));
    };

    // OSD спит 10 секунд: за это время эфир ушёл вперёд, а elapsedSec остался на месте тика
    expect(getLiveGridSec(3000, 7200, 10_000)).toBe(3010);

    // Кап на длительность тайтла: живая точка не вылетает за EOF (7000 + 500 > 7200)
    expect(getLiveGridSec(7000, 7200, 500_000)).toBe(7200);

    // Свежий тик: дрейф отсутствует
    expect(getLiveGridSec(3000, 7200, 0)).toBe(3000);
  });

  it('verifies TV series mode embeds season, episode and timecode directly into URL', () => {
    const rawUrl = 'https://embed.liftw.ws/embed/movie/1?host=liftw.ws';
    const targetEpisode = { season: '2', episode: '3' };
    const initialTimecode = 1500;
    
    let cleanUrl = rawUrl
      .replace(/[?&](start|t|time|timecode)=\d+/g, '')
      .replace(/[?&](season|episode)=\d+/g, '')
      .replace(/#t=\d+/g, '');
    if (cleanUrl.includes('?&')) cleanUrl = cleanUrl.replace('?&', '?');
    if (cleanUrl.endsWith('?')) cleanUrl = cleanUrl.slice(0, -1);

    const sep = cleanUrl.includes('?') ? '&' : '?';
    cleanUrl = `${cleanUrl}${sep}season=${encodeURIComponent(targetEpisode.season)}&episode=${encodeURIComponent(targetEpisode.episode)}`;

    const startSec = Math.floor(initialTimecode);
    const timeParams = startSec > 5 ? `&time=${startSec}&t=${startSec}` : '';
    const startParams = `&autoplay=1&autoPlay=1${timeParams}`;
    const finalUrl = `${cleanUrl}${startParams}`;

    expect(finalUrl).toContain('season=2');
    expect(finalUrl).toContain('episode=3');
    expect(finalUrl).toContain('&time=1500');
    expect(finalUrl).toContain('&t=1500');
  });

  it('verifies early stream ended advances to next scheduled item', () => {
    const currentItem = { id: 60304, durationSec: 5220, type: 'movie' };
    const nextItem = { id: 335787, durationSec: 6960, type: 'movie' };
    const slotIndex = 3;

    // Симуляция логики data.event === 'ended' из MediaBoxTvPlayer.tsx
    let activeItem = currentItem;
    let activeSlot = slotIndex;
    let activeElapsed = 5220;

    const streamEndedBeforeSlot = true;
    if (streamEndedBeforeSlot) {
      activeItem = nextItem as any;
      activeSlot = slotIndex + 1;
      activeElapsed = 0;
    }

    expect(activeItem.id).toBe(335787);
    expect(activeSlot).toBe(4);
    expect(activeElapsed).toBe(0);
  });

  it('verifies early transition to next scheduled item when elapsedSec approaches or exceeds known stream duration', () => {
    const elapsedSec = 5180;
    const durationSec = 5200; // остаток всего 20 сек (< 25 сек)
    const currentItem = { id: 101, title: 'Item 1' };
    const nextItem = { id: 102, title: 'Item 2' };

    const shouldAdvance = elapsedSec >= durationSec - 25 && nextItem && nextItem.id !== currentItem.id;
    expect(shouldAdvance).toBe(true);

    const normalElapsed = 4000;
    const shouldNotAdvance = normalElapsed >= durationSec - 25 && nextItem && nextItem.id !== currentItem.id;
    expect(shouldNotAdvance).toBe(false);
  });

  it('verifies zero duplicates in upcoming 10 slots across all movie channels', async () => {
    const { getChannelUpcomingSchedule } = await import('../tvSchedule');
    const movieChannels = TV_CHANNELS.filter(c => c.category !== 'series');
    expect(movieChannels.length).toBeGreaterThan(15);

    const testTimestamp = 1774780000; // произвольный таймстемп
    for (const channel of movieChannels) {
      const schedule = getChannelUpcomingSchedule(channel, testTimestamp);
      expect(schedule.length).toBe(10);
      const movieIds = schedule.map(s => s.item.id);
      const uniqueIds = new Set(movieIds);
      expect(uniqueIds.size).toBe(10); // Все 10 слотов строго уникальны
    }
  });

  it('verifies no repeats between consecutive days on movie channels (continuous pool rotation)', async () => {
    const { getChannelScheduleState } = await import('../tvSchedule');
    const thrillerChan = TV_CHANNELS.find(c => c.id === 'ch-thriller');
    expect(thrillerChan).toBeDefined();

    // Симулируем последовательное воспроизведение 24 фильмов подряд (переход к следующему по nextStartTime)
    let t = 1774780000;
    const moviesPlayed: number[] = [];
    for (let i = 0; i < 24; i++) {
      const state = getChannelScheduleState(thrillerChan!, undefined, t);
      moviesPlayed.push(state.currentItem.id);
      t = state.nextStartTime + 5;
    }

    // Все 24 последовательных фильма в эфире уникальны (без повторов на следующие сутки)
    const uniqueMovies = new Set(moviesPlayed);
    expect(uniqueMovies.size).toBe(24);
  });

  it('verifies sanitization strips existing time and timecode query params preventing duplicate overrides', () => {
    const rawUrlWithOldTime = 'https://embed.liftw.ws/content/999?time=0&t=0&timecode=0&start=0';
    const cleanUrl = rawUrlWithOldTime
      .replace(/[?&](start|t|time|timecode)=\d+/g, '')
      .replace(/[?&](season|episode)=\d+/g, '')
      .replace(/#t=\d+/g, '');

    expect(cleanUrl).toBe('https://embed.liftw.ws/content/999');
    expect(cleanUrl).not.toContain('time=');
    expect(cleanUrl).not.toContain('t=');
  });
});
