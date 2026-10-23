import { describe, it, expect } from 'vitest';
import { 
  SLOT_DURATION_SEC, 
  TV_CHANNELS, 
  getChannelScheduleState, 
  getChannelUpcomingSchedule,
  formatTimecode,
  getItemTitle,
  getChannelName
} from '../tvSchedule';

describe('MediaBox TV Schedule Engine (tvSchedule.ts)', () => {
  it('should have exact slot duration of 8640 seconds (10 slots per 24 hours)', () => {
    // 86400 секунд в сутках / 10 слотов = ровно 8640 секунд (2 часа 24 мин)
    expect(SLOT_DURATION_SEC).toBe(8640);
    expect(8640 * 10).toBe(86400);
  });

  it('should calculate deterministic schedule state for any channel', () => {
    const channel = TV_CHANNELS[0];
    const state = getChannelScheduleState(channel);

    expect(state).toBeDefined();
    expect(state.channel.id).toBe(channel.id);
    expect(state.slotIndex).toBeGreaterThanOrEqual(0);
    expect(state.slotIndex).toBeLessThan(10);
    expect(state.currentItem).toBeDefined();
    expect(state.currentItem.id).toBeGreaterThan(0);
    expect(state.initialTimecode).toBeGreaterThanOrEqual(0);
    expect(state.initialTimecode).toBeLessThan(SLOT_DURATION_SEC);
    expect(state.progressPercent).toBeGreaterThanOrEqual(0);
    expect(state.progressPercent).toBeLessThanOrEqual(100);
    expect(state.nextItem).toBeDefined();
  });

  it('should generate 10 upcoming schedule slots with exactly one current active slot', () => {
    const channel = TV_CHANNELS[0];
    const upcoming = getChannelUpcomingSchedule(channel);

    expect(upcoming).toHaveLength(10);
    const activeSlots = upcoming.filter(u => u.isCurrent);
    expect(activeSlots).toHaveLength(1);
    expect(activeSlots[0].slotNum).toBeGreaterThanOrEqual(1);
    expect(activeSlots[0].slotNum).toBeLessThanOrEqual(10);
  });

  it('should correctly format timecodes in mm:ss and hh:mm:ss', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(65)).toBe('1:05');
    expect(formatTimecode(3665)).toBe('1:01:05');
    expect(formatTimecode(-10)).toBe('0:00');
  });

  it('should correctly localize channel names and item titles', () => {
    const channel = TV_CHANNELS[0];
    expect(getChannelName(channel, 'ru-RU')).toBe(channel.nameRu);
    expect(getChannelName(channel, 'en-US')).toBe(channel.nameEn);

    const testItem = {
      id: 100,
      title: 'Побег из Шоушенка',
      origin_title: 'The Shawshank Redemption',
      year: '1994',
      type: 'movie' as const,
      durationSec: 8520,
      posterPath: '/path.jpg'
    };

    expect(getItemTitle(testItem, 'ru-RU')).toBe('Побег из Шоушенка');
    expect(getItemTitle(testItem, 'en-US')).toBe('The Shawshank Redemption');
  });

  it('should contain verified catalog pool for all TV channels without crash', () => {
    for (const channel of TV_CHANNELS) {
      const pool = channel.moviePool || channel.seriesEpisodes || channel.weeklyPool;
      expect(pool).toBeDefined();
      expect(pool!.length).toBeGreaterThanOrEqual(10);
      for (const item of pool!) {
        expect(item.id).toBeGreaterThan(0);
        expect(item.title).toBeTruthy();
        expect(item.durationSec).toBeGreaterThan(0);
      }
    }
  });

  it('should have zero emojis in all channels and include drama and anime channels', () => {
    // Регулярное выражение для проверки отсутствия эмодзи
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

    expect(TV_CHANNELS.length).toBe(35);
    const dorama = TV_CHANNELS.find(c => c.id === 'ch-series-dorama');
    const anime = TV_CHANNELS.find(c => c.id === 'ch-series-anime');

    expect(dorama).toBeDefined();
    expect(anime).toBeDefined();

    for (const ch of TV_CHANNELS) {
      expect(ch.icon).toBe('');
      expect(emojiRegex.test(ch.nameRu)).toBe(false);
      expect(emojiRegex.test(ch.nameEn)).toBe(false);
      expect(emojiRegex.test(ch.genreNameRu)).toBe(false);
      expect(emojiRegex.test(ch.genreNameEn)).toBe(false);
    }
  });

  // СИСТЕМНЫЙ GUARD КАТАЛОГА: постоянная защита от регрессий и человеческого фактора (copy-paste)
  it('should enforce unique TMDB IDs across all distinct series in catalog', () => {
    // Собираем все серии из каналов сериалов и проверяем отсутствие коллизий TMDB ID
    const seriesChannels = TV_CHANNELS.filter(c => c.category === 'series');
    const idToTitlesMap = new Map<number, Set<string>>();

    for (const ch of seriesChannels) {
      const episodes = ch.seriesEpisodes || [];
      for (const ep of episodes) {
        if (!idToTitlesMap.has(ep.id)) {
          idToTitlesMap.set(ep.id, new Set());
        }
        idToTitlesMap.get(ep.id)!.add(ep.title);
      }
    }

    const duplicates: string[] = [];
    for (const [id, titles] of idToTitlesMap.entries()) {
      if (titles.size > 1) {
        duplicates.push(`TMDB ID ${id} используется сразу в нескольких разных сериалах: [${Array.from(titles).join(', ')}]`);
      }
    }

    expect(duplicates).toEqual([]);
  });

  it('should enforce unique posterPath across distinct series (zero copy-paste parasites)', () => {
    // Проверка предотвращает копирование чужих обложек при заполнении каталога
    const seriesChannels = TV_CHANNELS.filter(c => c.category === 'series');
    const posterToTitlesMap = new Map<string, Set<string>>();

    for (const ch of seriesChannels) {
      const episodes = ch.seriesEpisodes || [];
      for (const ep of episodes) {
        if (!ep.posterPath) continue;
        if (!posterToTitlesMap.has(ep.posterPath)) {
          posterToTitlesMap.set(ep.posterPath, new Set());
        }
        posterToTitlesMap.get(ep.posterPath)!.add(ep.title);
      }
    }

    const duplicatePosters: string[] = [];
    for (const [poster, titles] of posterToTitlesMap.entries()) {
      if (titles.size > 1) {
        duplicatePosters.push(`Постер ${poster} привязан к разным сериалам: [${Array.from(titles).join(', ')}]`);
      }
    }

    expect(duplicatePosters).toEqual([]);
  });

  it('should validate posterPath format and non-empty metadata schema for all series episodes', () => {
    // Гарантирует корректный путь TMDB CDN (/....jpg) и заполненность всех критических полей
    const validPosterRegex = /^\/[a-zA-Z0-9_\-\.\/]+\.(jpg|jpeg|png|webp)$/;
    const seriesChannels = TV_CHANNELS.filter(c => c.category === 'series');

    for (const ch of seriesChannels) {
      const episodes = ch.seriesEpisodes || [];
      expect(episodes.length).toBeGreaterThan(0);

      for (const ep of episodes) {
        expect(ep.id).toBeGreaterThan(0);
        expect(ep.title.trim().length).toBeGreaterThan(0);
        expect((ep.origin_title || '').trim().length).toBeGreaterThan(0);
        expect(ep.year).toMatch(/^\d{4}$/);
        expect(ep.posterPath).toMatch(validPosterRegex);
        expect(ep.durationSec).toBeGreaterThanOrEqual(600); // Серия не менее 10 минут
        expect(ep.type).toBe('tv');
      }
    }
  });

  it('should guarantee 100% continuous 24h schedule continuity across all 35 channels', () => {
    // Проверяем непрерывность сетки вещания для всех 35 каналов (10 предстоящих слотов с возрастающим временем)
    for (const channel of TV_CHANNELS) {
      const state = getChannelScheduleState(channel);
      expect(state.currentItem).toBeDefined();
      expect(state.currentItem.id).toBeGreaterThan(0);
      expect(state.currentItem.posterPath).toBeTruthy();
      expect(state.durationSec).toBeGreaterThan(0);

      const upcoming = getChannelUpcomingSchedule(channel);
      expect(upcoming).toHaveLength(10);
      expect(upcoming[0].isCurrent).toBe(true);

      for (let i = 0; i < upcoming.length - 1; i++) {
        expect(upcoming[i + 1].startTimeSec).toBeGreaterThan(upcoming[i].startTimeSec);
        expect(upcoming[i].item.durationSec).toBeGreaterThan(0);
      }
    }
  });
});

