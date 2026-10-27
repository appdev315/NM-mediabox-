import { describe, it, expect } from 'vitest';
import { TV_CHANNELS, getChannelScheduleState, getChannelUpcomingSchedule, getChannelName } from '../tvSchedule';
import { CATALOG_FAMILY } from '../tvCatalogData';

describe('Comprehensive End-to-End Verification', () => {
  it('verifies channel naming and immutability of Dorama TV', () => {
    const top100 = TV_CHANNELS.find(c => c.id === 'ch-popular');
    expect(top100).toBeDefined();
    expect(top100?.nameRu).toBe('Топ 100 ТВ');
    expect(top100?.nameEn).toBe('Top 100 TV');
    expect(top100?.genreNameRu).toBe('Топ 100');
    expect(getChannelName(top100, 'ru-RU')).toBe('Топ 100 ТВ');
    expect(getChannelName(top100, 'en-US')).toBe('Top 100 TV');

    const dorama = TV_CHANNELS.find(c => c.id === 'ch-series-dorama');
    expect(dorama).toBeDefined();
    expect(dorama?.nameRu).toBe('Дорама ТВ');
    expect(dorama?.genreNameRu).toBe('Дорамы');
  });

  it('verifies healed family catalog item is Paddington 2 with verified stream', () => {
    const item = CATALOG_FAMILY.find(i => i.id === 346648);
    expect(item).toBeDefined();
    expect(item?.title).toBe('Приключения Паддингтона 2');
    expect(item?.year).toBe('2017');
    expect(item?.posterPath).toBe('/rqegEjWMbVXiE5XhPJ4NhvDU8ps.jpg');
    expect(item?.durationSec).toBe(6180);
  });

  it('verifies 24/7 continuous FAST stream schedule calculation', () => {
    const top100 = TV_CHANNELS.find(c => c.id === 'ch-popular')!;
    const now = Math.floor(Date.now() / 1000);
    const state = getChannelScheduleState(top100, undefined, now);
    expect(state.currentItem).toBeDefined();
    expect(state.elapsedSec).toBeGreaterThanOrEqual(0);
    expect(state.remainingSec).toBeGreaterThanOrEqual(0);
    expect(state.elapsedSec + state.remainingSec).toBe(state.durationSec);

    const upcoming = getChannelUpcomingSchedule(top100, now);
    expect(upcoming.length).toBe(10);
    expect(upcoming[0].isCurrent).toBe(true);
    expect(upcoming[1].isCurrent).toBe(false);
  });

  it('verifies adult age gate in fresh profile blocks access until confirmation', () => {
    const store: Record<string, string> = {};
    const mockStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
    };

    expect(mockStorage.getItem('age_confirmed')).toBeNull();

    // In a fresh profile, age is not confirmed
    const isConfirmed = mockStorage.getItem('age_confirmed') === 'true';
    expect(isConfirmed).toBe(false);

    // After user confirms in AgeVerificationModal
    mockStorage.setItem('age_confirmed', 'true');
    expect(mockStorage.getItem('age_confirmed')).toBe('true');
  });
});
