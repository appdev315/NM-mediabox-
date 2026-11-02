export function sortNumericKeys(keys: (string | number)[]): string[] {
  return keys.map(String).sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export interface LiftwQueryParams {
  title?: string;
  name?: string;
  year?: string | number;
  type: string;
  tmdb?: string | number;
  title_ru?: string;
  original_title?: string;
  original_name?: string;
  liftw_id?: string | number;
  language?: string;
}

export function buildLiftwQuery(params: LiftwQueryParams): string {
  const bgTitle = (params.title || params.name || '').trim();
  const ru = params.language === 'ru-RU' ? (params.title_ru || bgTitle) : (params.title_ru || '');
  const orig = (params.original_title || params.original_name || '').trim();
  const idStr = params.tmdb ? String(params.tmdb) : '';
  const effectiveLiftwId = params.liftw_id || (idStr.startsWith('liftw_') ? idStr.replace(/^liftw_/, '') : undefined);

  const queryParams: Record<string, string> = {
    title: bgTitle,
    year: params.year ? String(params.year).slice(0, 4) : '',
    type: params.type,
    tmdb: idStr,
    title_ru: ru,
    original_title: orig,
  };

  if (effectiveLiftwId) {
    queryParams.liftw_id = String(effectiveLiftwId);
  }

  return new URLSearchParams(queryParams).toString();
}

export function deduplicateMediaList<T extends { id?: any; title?: string; name?: string; type?: string; media_type?: string }>(list: T[]): T[] {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  return list.filter((item) => {
    if (!item || !item.id) return false;
    const idKey = String(item.id);
    const normTitle = (item.title || item.name || '').trim().toLowerCase();
    if (seenIds.has(idKey)) return false;
    // Составной ключ «тип|название»: фильм и сериал с одинаковым названием — разные
    // тайтлы и не должны склеиваться («Дюна» 1984/2021, movie vs tv). Год не включаем:
    // источники расходятся в годе премьеры/релиза, а кросс-источниковые дубли
    // (tmdb_ vs liftw_) склеиваются именно по названию.
    const rawType = String(item.type || item.media_type || '').trim().toLowerCase();
    const typeKey = rawType === 'series' ? 'tv' : rawType;
    const dedupeKey = typeKey ? `${typeKey}|${normTitle}` : normTitle;
    if (normTitle && seenKeys.has(dedupeKey)) return false;
    seenIds.add(idKey);
    if (normTitle) seenKeys.add(dedupeKey);
    return true;
  });
}

// Domestic-origin detector shared by catalog backstops. Mirrors the backend
// isRussianOrigin(): TMDB markers first, then the request-free Liftw rule —
// a Cyrillic display title combined with an empty/non-Latin origin name.
export function isRussianOrigin(item: any): boolean {
  if (!item) return false;
  if (item.isDrama) return false;
  if (item.original_language === 'ru') return true;
  if (item.original_language && item.original_language !== 'ru') return false;
  const oc = item.origin_country;
  if (Array.isArray(oc) && (oc.includes('RU') || oc.includes('SU'))) return true;
  if (Array.isArray(oc) && oc.length > 0 && !oc.includes('RU') && !oc.includes('SU')) return false;
  const pc = item.production_countries;
  if (Array.isArray(pc) && pc.some((c: any) => c?.iso_3166_1 === 'RU' || c?.iso_3166_1 === 'SU')) return true;
  const countries = item.country || item.countries;
  if (Array.isArray(countries) && countries.some((c: any) => /^(Россия|СССР|Russia|Soviet Union)$/i.test(String(c).trim()))) return true;
  const origin = (item.original_name || item.original_title || item.origin_name || '').trim();
  if (/[\uac00-\ud7af\u4e00-\u9fff\u3040-\u30ff]/i.test(origin)) return false;
  const title = (item.title || item.name || '').trim();
  if (/[а-яё]/i.test(title) && !/[a-z]/i.test(origin)) return true;
  return false;
}

export function isNonRussianLang(lang: string): boolean {
  return !String(lang || '').toLowerCase().startsWith('ru');
}

/**
 * Выбирает наиболее подходящий результат поиска TMDB для заданного названия и года.
 * Защищает от ложных срабатываний (коллизий), когда подстрока запроса совпадает
 * с другим тайтлом (например, запрос «Бригада» vs «Женская бригада»).
 */
export function pickBestTmdbMatch<T extends {
  id?: any;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  first_air_date?: string;
  release_date?: string;
  popularity?: number;
}>(
  results: T[],
  targetTitle: string,
  targetYear?: number | string
): T | null {
  if (!Array.isArray(results) || results.length === 0 || !targetTitle) {
    return null;
  }

  const norm = (s?: string) =>
    (s || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]/gi, '')
      .trim();

  const normTarget = norm(targetTitle);
  if (!normTarget) return results[0] || null;

  const numTargetYear = typeof targetYear === 'string' ? parseInt(targetYear, 10) : (targetYear || 0);

  let bestItem: T | null = null;
  let highestScore = -1;

  for (const item of results) {
    if (!item) continue;

    const titles = [
      norm(item.title),
      norm(item.name),
      norm(item.original_title),
      norm(item.original_name),
    ].filter(Boolean);

    let titleScore = 0;
    const isExact = titles.some(t => t === normTarget);

    if (isExact) {
      titleScore = 100;
    } else {
      // Подстрочные совпадения
      const isSub = titles.some(t => t.includes(normTarget) || normTarget.includes(t));
      if (isSub) {
        const minLenDelta = Math.min(...titles.map(t => Math.abs(t.length - normTarget.length)));
        titleScore = Math.max(10, 60 - minLenDelta * 4);
      } else {
        titleScore = 0;
      }
    }

    if (titleScore === 0) continue;

    // Оценка совпадения года
    const rawDate = item.first_air_date || item.release_date || '';
    const itemYear = parseInt(String(rawDate).slice(0, 4), 10) || 0;
    let yearBonus = 0;

    if (numTargetYear > 0 && itemYear > 0) {
      const delta = Math.abs(itemYear - numTargetYear);
      if (delta === 0) {
        yearBonus = 25;
      } else if (delta === 1) {
        yearBonus = 15;
      } else if (delta === 2) {
        yearBonus = 5;
      } else {
        yearBonus = -Math.min(50, delta * 10);
      }
    }

    const popBonus = Math.min(5, (item.popularity || 0) * 0.05);
    const totalScore = titleScore + yearBonus + popBonus;

    if (totalScore > highestScore) {
      highestScore = totalScore;
      bestItem = item;
    }
  }

  return highestScore >= 30 ? bestItem : null;
}

