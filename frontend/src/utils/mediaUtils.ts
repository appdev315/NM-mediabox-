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

export function deduplicateMediaList<T extends { id?: any; title?: string; name?: string }>(list: T[]): T[] {  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  return list.filter((item) => {
    if (!item || !item.id) return false;
    const idKey = String(item.id);
    const normTitle = (item.title || item.name || '').trim().toLowerCase();
    if (seenIds.has(idKey)) return false;
    if (normTitle && seenTitles.has(normTitle)) return false;
    seenIds.add(idKey);
    if (normTitle) seenTitles.add(normTitle);
    return true;
  });
}

// Domestic-origin detector shared by catalog backstops. Mirrors the backend
// isRussianOrigin(): TMDB markers first, then the request-free Liftw rule —
// a Cyrillic display title combined with an empty/non-Latin origin name.
export function isRussianOrigin(item: any): boolean {
  if (!item) return false;
  if (item.original_language === 'ru') return true;
  const oc = item.origin_country;
  if (Array.isArray(oc) && (oc.includes('RU') || oc.includes('SU'))) return true;
  const pc = item.production_countries;
  if (Array.isArray(pc) && pc.some((c: any) => c?.iso_3166_1 === 'RU' || c?.iso_3166_1 === 'SU')) return true;
  const countries = item.country || item.countries;
  if (Array.isArray(countries) && countries.some((c: any) => /^(Россия|СССР|Russia|Soviet Union)$/i.test(String(c).trim()))) return true;
  const origin = (item.original_name || item.original_title || item.origin_name || '').trim();
  const title = (item.title || item.name || '').trim();
  if (/[а-яё]/i.test(title) && !/[a-z]/i.test(origin)) return true;
  return false;
}

export function isNonRussianLang(lang: string): boolean {
  return !String(lang || '').toLowerCase().startsWith('ru');
}
