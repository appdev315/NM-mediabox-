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

export function deduplicateMediaList<T extends { id?: any; title?: string; name?: string }>(list: T[]): T[] {
  const seenIds = new Set<string>();
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
