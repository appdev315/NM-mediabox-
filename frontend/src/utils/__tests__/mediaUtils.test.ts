import { describe, it, expect } from 'vitest';
import { 
  buildLiftwQuery, 
  deduplicateMediaList, 
  isRussianOrigin, 
  sortNumericKeys,
  isNonRussianLang,
  pickBestTmdbMatch
} from '../mediaUtils';

describe('Media Utilities (mediaUtils.ts)', () => {
  it('should serialize liftw query correctly', () => {
    const q1 = buildLiftwQuery({
      title: 'Интерстеллар',
      year: '2014',
      type: 'movie',
      tmdb: '157336',
      language: 'ru-RU'
    });

    const params = new URLSearchParams(q1);
    expect(params.get('title')).toBe('Интерстеллар');
    expect(params.get('year')).toBe('2014');
    expect(params.get('type')).toBe('movie');
    expect(params.get('tmdb')).toBe('157336');
  });

  it('should extract liftw_id if provided or prefixed', () => {
    const q = buildLiftwQuery({
      type: 'movie',
      tmdb: 'liftw_98765',
    });

    const params = new URLSearchParams(q);
    expect(params.get('liftw_id')).toBe('98765');
  });

  it('should deduplicate media items by composite key (type + title)', () => {
    const list = [
      { id: 1, title: 'Дюна', type: 'movie' },
      { id: 2, title: 'Дюна', type: 'movie' }, // duplicate title + type
      { id: 3, title: 'Дюна', type: 'tv' },    // different type (series) -> keep
      { id: 4, title: 'Матрица', type: 'movie' },
    ];

    const deduped = deduplicateMediaList(list);
    expect(deduped).toHaveLength(3);
    expect(deduped.map(i => i.id)).toEqual([1, 3, 4]);
  });

  it('should correctly detect Russian origin content', () => {
    expect(isRussianOrigin({ original_language: 'ru' })).toBe(true);
    expect(isRussianOrigin({ origin_country: ['RU'] })).toBe(true);
    expect(isRussianOrigin({ original_language: 'en' })).toBe(false);
    expect(isRussianOrigin({ origin_country: ['US'] })).toBe(false);
    expect(isRussianOrigin({ isDrama: true, original_language: 'ru' })).toBe(false);
  });

  it('should sort numeric keys naturally', () => {
    const keys = ['10', '2', '1', '20', '3'];
    expect(sortNumericKeys(keys)).toEqual(['1', '2', '3', '10', '20']);
  });

  it('should detect non-Russian languages', () => {
    expect(isNonRussianLang('en-US')).toBe(true);
    expect(isNonRussianLang('de-DE')).toBe(true);
    expect(isNonRussianLang('ru-RU')).toBe(false);
    expect(isNonRussianLang('ru')).toBe(false);
  });

  describe('pickBestTmdbMatch', () => {
    it('should correctly select Бригада (2002) over Женская бригада (2001) for query Бригада', () => {
      const candidates = [
        { id: 2222, name: 'Женская бригада', first_air_date: '2001-01-07', popularity: 15 },
        { id: 30877, name: 'Бригада', first_air_date: '2002-09-23', popularity: 40 },
        { id: 49875, name: "La Crim'", first_air_date: '1999-06-11', popularity: 5 }
      ];

      const match = pickBestTmdbMatch(candidates, 'Бригада', 2002);
      expect(match).not.toBeNull();
      expect(match?.id).toBe(30877);
      expect(match?.name).toBe('Бригада');
    });

    it('should correctly select Женская бригада (2001) when query is Женская бригада', () => {
      const candidates = [
        { id: 2222, name: 'Женская бригада', first_air_date: '2001-01-07', popularity: 15 },
        { id: 30877, name: 'Бригада', first_air_date: '2002-09-23', popularity: 40 },
      ];

      const match = pickBestTmdbMatch(candidates, 'Женская бригада', 2001);
      expect(match).not.toBeNull();
      expect(match?.id).toBe(2222);
      expect(match?.name).toBe('Женская бригада');
    });

    it('should reject completely unrelated candidates', () => {
      const candidates = [
        { id: 999, name: 'Королевство кривых зеркал', first_air_date: '1963-01-01', popularity: 2 }
      ];

      const match = pickBestTmdbMatch(candidates, 'Бригада', 2002);
      expect(match).toBeNull();
    });

    it('should handle movie title matching with release_date', () => {
      const candidates = [
        { id: 101, title: 'Брат', release_date: '1997-05-17', popularity: 30 },
        { id: 102, title: 'Брат 2', release_date: '2000-05-11', popularity: 35 },
      ];

      const match = pickBestTmdbMatch(candidates, 'Брат', 1997);
      expect(match?.id).toBe(101);
    });
  });
});

