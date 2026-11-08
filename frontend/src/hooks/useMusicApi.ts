import { useState, useCallback, useRef, useEffect } from 'react';
import { clientCache } from '../utils/clientCache';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { CF_API_BASE } from './useApi';

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl: string;
  audioUrl: string;
  /** Low-bitrate stream (<=160 kbps) for the Data saver mode */
  audioUrlLow?: string;
  duration?: number;
  releaseDate?: string;
  genre?: string;
  isResolved?: boolean;
  views?: number;
  isOfficialArtistTop?: boolean;
}

export interface MusicAlbum {
  id: string;
  title: string;
  artist: string;
  year?: string;
  artworkUrl: string;
  songCount?: number;
}

import {
  type NetworkSpeedInfo,
  type MusicDataSaverMode,
  getNetworkSpeed,
  getMusicDataSaverMode,
  isMusicDataSaverEffective,
  setMusicDataSaverMode,
  isMusicDataSaverEnabled,
  setMusicDataSaver,
  resolveFullAudioUrl,
  getInvidiousInstances,
  recordInvidiousOutcome,
  parseYtDuration,
  extractInvidiousAudio,
  extractAudioUrl,
  extractLowAudioUrl,
  extractArtwork,
  decodeHtmlEntities,
  saavnApiFetch,
  INVIDIOUS_SEED_INSTANCES
} from '../utils/musicResolver';

export {
  type NetworkSpeedInfo,
  type MusicDataSaverMode,
  getNetworkSpeed,
  getMusicDataSaverMode,
  isMusicDataSaverEffective,
  setMusicDataSaverMode,
  isMusicDataSaverEnabled,
  setMusicDataSaver,
  resolveFullAudioUrl,
  getInvidiousInstances,
  recordInvidiousOutcome,
  parseYtDuration,
  extractInvidiousAudio,
  extractAudioUrl,
  extractLowAudioUrl,
  extractArtwork,
  decodeHtmlEntities,
  saavnApiFetch,
  INVIDIOUS_SEED_INSTANCES
};

export const PLACEHOLDER_ARTWORK = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="%238E8E93"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';

const extractArtistName = (item: any): string => {
  if (item.artists?.primary && item.artists.primary.length > 0) {
    return decodeHtmlEntities(item.artists.primary.map((a: any) => a.name).join(', '));
  }
  if (item.primaryArtists) {
    return decodeHtmlEntities(item.primaryArtists);
  }
  if (item.artists?.all && item.artists.all.length > 0) {
    return decodeHtmlEntities(item.artists.all.map((a: any) => a.name).join(', '));
  }
  return 'Unknown Artist';
};

const mapSaavnSongToTrack = (song: any, index: number, isSlow = false): MusicTrack | null => {
  const audioUrl = extractAudioUrl(song.downloadUrl, isSlow);
  const title = decodeHtmlEntities(song.name || song.title || '');
  if (!audioUrl || !title) return null;

  const rawArtist = extractArtistName(song);
  const stableId = song.id
    ? String(song.id)
    : `saavn_${title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${rawArtist.toLowerCase().replace(/[^a-z0-9]/g, '') || index}`;
  const dur = typeof song.duration === 'number' ? song.duration : parseInt(song.duration || '0', 10);

  return {
    id: stableId,
    title,
    artist: rawArtist,
    album: decodeHtmlEntities(song.album?.name || ''),
    artworkUrl: extractArtwork(song.image),
    audioUrl,
    audioUrlLow: extractLowAudioUrl(song.downloadUrl) || audioUrl,
    duration: dur > 0 ? dur : undefined, // no fake 3:00 badge for unknown durations
    releaseDate: String(song.year || song.releaseDate || ''),
    genre: song.language || 'Music',
    isResolved: true
  };
};

// --- ТРАНСЛИТЕРАЦИЯ И СЛОВАРЬ АЛИАСОВ ДЛЯ ТОЧНОГО ПОИСКА ---
const RU_TO_EN: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z',
  'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
  'с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
  'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
};

export const transliterateRuToEn = (str: string): string => {
  return (str || '').toLowerCase().split('').map(ch => RU_TO_EN[ch] !== undefined ? RU_TO_EN[ch] : ch).join('');
};

export const normalizeStr = (str: string): string => {
  return (str || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
};

export const tokenize = (str: string): string[] => {
  return (str || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !['и', 'в', 'на', 'с', 'по', 'the', 'a', 'an', 'of', 'and'].includes(w));
};

// Словарь распространенных псевдонимов и транслитераций для точного поиска
export const MUSIC_SEARCH_ALIASES: Record<string, string> = {
  'нагано': 'ноггано',
  'nagano': 'ноггано',
  'noggano': 'ноггано',
  'basta': 'баста',
  'кино': 'группа кино',
  'цой': 'виктор цой',
  'tsoi': 'виктор цой',
  'kino': 'группа кино',
  'король и шут': 'киш',
  'миаги': 'miyagi',
  'мияги': 'miyagi',
  'эндшпиль': 'endshpil',
  'скрип': 'скриптонит',
  'scryptonite': 'скриптонит',
  'scriptonite': 'скриптонит'
};

export const cleanYtTitle = (raw: string): string => {
  return (raw || '')
    .replace(/\s*[([]\s*[^)\]]*(?:official|video|audio|lyric|remaster|explicit|edit|version|clip|клип|премьера|нашествие|концерт|soundtrack|саундтрек|ost|hd|4k|hq|cam|subtitles|subs|текст)[^)\]]*[)\]]/gi, '')
    .replace(/\s*(?:\||–|-|•)\s*(?:official\s*video|official\s*audio|клип|премьера\s*\d{4}|4k|hd|remastered?|текст\s*песни|lyrics?|live).*$/gi, '')
    .replace(/\s*\|.*$/g, '')
    .replace(/\b(?:текст\s*песни|lyrics?)\b/gi, '')
    .trim();
};

// Интеллектуальный разбор метаданных YouTube: вычленение исполнителя и названия
export const parseYtTrackInfo = (rawTitle: string, rawAuthor: string, query = '') => {
  const title = cleanYtTitle(rawTitle);
  const artist = (rawAuthor || 'Unknown Artist').replace(/ - Topic$/i, '').trim();

  const authorNorm = normalizeStr(artist.replace(/\b(?:official|music|records|vevo|channel|группа)\b/gi, ''));

  const quoteMatch = title.match(/^([^"«»]+)\s*["«]([^"»]+)["»]$/);
  if (quoteMatch) {
    return { title: quoteMatch[2].trim(), artist: quoteMatch[1].trim() };
  }

  const splitMatch = title.match(/^([^-–—]+)\s*[-–—]\s*(.+)$/);
  if (splitMatch) {
    const p1 = splitMatch[1].trim();
    const p2 = splitMatch[2].trim();
    const p1Norm = normalizeStr(p1);
    const p2Norm = normalizeStr(p2);
    const normQ = normalizeStr(query);

    if (authorNorm && (p2Norm.includes(authorNorm) || authorNorm.includes(p2Norm)) && !p1Norm.includes(authorNorm)) {
      return { title: p1.replace(/^["'«]+|["'»]+$/g, '').trim(), artist: p2 };
    }

    if (p1Norm === normQ || (normQ.length > 3 && p1Norm.includes(normQ))) {
      return { title: p1.replace(/^["'«]+|["'»]+$/g, '').trim(), artist: p2 };
    }
    if (p2Norm === normQ || (normQ.length > 3 && p2Norm.includes(normQ))) {
      return { title: p2.replace(/^["'«]+|["'»]+$/g, '').trim(), artist: p1 };
    }

    return { title: p2.replace(/^["'«]+|["'»]+$/g, '').trim(), artist: p1.replace(/^["'«]+|["'»]+$/g, '').trim() };
  }

  return { title, artist };
};

// Стоп-слова немузыкального контента (разговорные шоу, подкасты, интервью, стримы, влоги)
const NON_MUSIC_REGEX = /\b(?:стендап|подкаст|podcast|standup|интервью|interview|шоу|выпуск|livestream|live\s*stream|влог|vlog|обзор|реакция|reaction)\b/i;

const mapYtSongToTrack = (item: any, query = ''): MusicTrack | null => {
  if (!item || !item.id || (!item.title && !item.name)) return null;
  if (item.type === 'channel' || item.type === 'playlist') return null;

  const dur = parseYtDuration(item);
  // Порог длительности треков: максимум 10 минут (600 сек) и минимум 20 сек
  if (dur > 600 || (dur > 0 && dur < 20)) return null;
  const rawTitle = decodeHtmlEntities(item.title || item.name || '');
  const rawAuthor = decodeHtmlEntities(item.author || 'Unknown Artist');
  if (NON_MUSIC_REGEX.test(rawTitle) || NON_MUSIC_REGEX.test(rawAuthor)) return null;

  let views = 0;
  if (typeof item.subtext === 'string') {
    const vMatch = item.subtext.replace(/,/g, '').match(/(\d+)\s*views/i);
    if (vMatch) views = parseInt(vMatch[1], 10);
  }

  const parsed = parseYtTrackInfo(rawTitle, rawAuthor, query);

  return {
    id: `yt_${item.id}`,
    title: parsed.title,
    artist: parsed.artist,
    album: 'YouTube Music',
    artworkUrl: `https://i.ytimg.com/vi/${item.id}/default.jpg`,
    audioUrl: '', // Resolves direct stream on click
    duration: dur > 0 ? dur : undefined,
    genre: 'Music',
    isResolved: false,
    views: views > 0 ? views : undefined,
  };
};



export function useMusicApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Счётчик активных поисков: одиночный булев гасил спиннер, пока параллельный
  // запрос (быстрый набор в поиске) ещё летел.
  const loadingCountRef = useRef(0);
  // Контроллеры незавершённых поисков: на размонтировании обрываем их —
  // не тратим трафик и не гоняем setState в мёртвый компонент.
  const searchAbortsRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    return () => {
      searchAbortsRef.current.forEach((c) => { try { c.abort(); } catch (_) {} });
      searchAbortsRef.current.clear();
      loadingCountRef.current = 0;
    };
  }, []);

  const searchMusic = useCallback(async (query: string, page = 1, limit = 20): Promise<MusicTrack[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = `cache_music_search_v10_${trimmed.toLowerCase()}_p${page}_l${limit}`;
    const cached = clientCache.get<MusicTrack[]>(cacheKey) || await clientCache.getAsync<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    // При бесконечном скролле (page > 1) активируем loading только для первой страницы,
    // чтобы предотвратить размонтирование DOM-дерева треков и сброс scrollY в 0
    const abortCtrl = new AbortController();
    searchAbortsRef.current.add(abortCtrl);
    const { signal } = abortCtrl;

    const isInitialPage = page === 1;
    if (isInitialPage) {
      loadingCountRef.current += 1;
      setLoading(true);
      setError(null);
    }
    const releaseInitialLoading = () => {
      if (!isInitialPage) return;
      loadingCountRef.current = Math.max(0, loadingCountRef.current - 1);
      if (loadingCountRef.current === 0) {
        setLoading(false);
      }
    };

    const { isSlow } = getNetworkSpeed();

    try {
      const encoded = encodeURIComponent(trimmed);

      // 1. Fast-path: 1 single request via Cloudflare Edge proxy v2/v3
      try {
        const edgeRes = await fetchWithRetry(`${CF_API_BASE}/music/v2/search?q=${encoded}&page=${page}&limit=${limit}&v=3`, { maxRetries: 0, signal });
        if (edgeRes && edgeRes.ok) {
          const edgeTracks = await edgeRes.json();
          if (Array.isArray(edgeTracks) && edgeTracks.length > 0) {
            const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
            const normalized = edgeTracks
              // Отсеиваем 30-секундные превью Deezer, треки длиннее 10 минут и немузыкальные видео
              .filter((t: any) => {
                if (t.audioUrl && t.audioUrl.includes('dzcdn')) return false;
                const dur = typeof t.duration === 'number' ? t.duration : (parseInt(t.duration, 10) || 0);
                if (dur > 600 || (dur > 0 && dur < 20)) return false;
                if (NON_MUSIC_REGEX.test(t.title || '') || NON_MUSIC_REGEX.test(t.artist || '')) return false;
                return true;
              })
              .map((t: MusicTrack) => {
                let artist = t.artist || '';
                if (hasJapanese.test(artist) && !/[a-z]/i.test(artist) && !hasJapanese.test(trimmed)) {
                  artist = trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
                }
                return {
                  ...t,
                  id: String(t.id || '').replace(/^saavn_/, ''),
                  artist,
                };
              });

            if (normalized.length > 0) {
              clientCache.set(cacheKey, normalized, 86400); // 24 hours TTL с авто-очисткой
              releaseInitialLoading();
              return normalized;
            }
          }
        }
      } catch (_) {
        // Edge proxy unavailable: fallback seamlessly to direct multi-provider search
      }

      // Multi-provider parallel search:
      // 1. JioSaavn Song Search (320k/160k direct streams с текущей страницей)
      // 2. JioSaavn Artist Search + Top Songs (на первых страницах)
      // 3. YouTube Music (Ytify) Search
      const [saavnSongRes, saavnArtistRes, ytRes] = await Promise.allSettled([
        saavnApiFetch(`search/songs?query=${encoded}&page=${page}&limit=${limit}`, signal),
        page <= 3 ? saavnApiFetch(`search/artists?query=${encoded}&limit=5`, signal) : Promise.resolve(null as any),
        page <= 3 ? fetchWithRetry(`https://api.ytify.workers.dev/search?q=${encoded}`, { maxRetries: 1, signal }) : Promise.resolve(null as any)
      ]);

      const seenIds = new Set<string>();
      const seenTitles = new Set<string>();
      const merged: MusicTrack[] = [];

      const addTrack = (t: MusicTrack) => {
        if (!t || !t.id || !t.title) return;
        const dur = t.duration || 0;
        if (dur > 600 || (dur > 0 && dur < 20)) return;
        if (NON_MUSIC_REGEX.test(t.title) || NON_MUSIC_REGEX.test(t.artist) || NON_MUSIC_REGEX.test(t.album || '')) return;

        const titleKey = `${normalizeStr(t.artist)}_${normalizeStr(t.title)}`;
        if (!seenIds.has(t.id) && !seenTitles.has(titleKey)) {
          seenIds.add(t.id);
          seenTitles.add(titleKey);
          merged.push(t);
        }
      };

      const normQ = normalizeStr(trimmed);
      const aliasNormQ = normalizeStr(MUSIC_SEARCH_ALIASES[normQ] || '');
      const translitNormQ = normalizeStr(transliterateRuToEn(trimmed));

      // 1. Топ-песни артиста
      if (saavnArtistRes.status === 'fulfilled' && saavnArtistRes.value && saavnArtistRes.value.ok) {
        try {
          const aJson = await saavnArtistRes.value.json();
          const artistCandidates: any[] = aJson?.data?.results || [];

          let bestCand: any = null;
          let bestScore = 0;
          for (const cand of artistCandidates) {
            const normC = normalizeStr(cand?.name);
            const translitNormC = normalizeStr(transliterateRuToEn(cand?.name || ''));
            let score = 0;
            if (normC === normQ) score = 100;
            else if (aliasNormQ && normC === aliasNormQ) score = 95;
            else if (translitNormC === normQ || normC === translitNormQ) score = 90;
            else if (normC.includes(normQ) || (aliasNormQ && normC.includes(aliasNormQ))) score = 80;

            if (score > bestScore) {
              bestScore = score;
              bestCand = cand;
            }
          }

          if (bestCand?.id && bestScore >= 80) {
            const [artistSongsRes, artistFullRes] = await Promise.allSettled([
              saavnApiFetch(`artists?id=${bestCand.id}`),
              saavnApiFetch(`artists/${bestCand.id}/songs?page=1`)
            ]);
            if (artistSongsRes.status === 'fulfilled' && artistSongsRes.value?.ok) {
              const asJson = await artistSongsRes.value.json();
              const topSongs = asJson?.data?.topSongs || [];
              const topTracks = topSongs
                .map((s: any, idx: number) => {
                  const tr = mapSaavnSongToTrack(s, idx, isSlow);
                  if (tr) tr.isOfficialArtistTop = true;
                  return tr;
                })
                .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
              for (const t of topTracks) {
                addTrack(t);
              }
            }
            if (artistFullRes.status === 'fulfilled' && artistFullRes.value?.ok) {
              const afJson = await artistFullRes.value.json();
              const artistSongs = afJson?.data?.songs || [];
              const moreTracks = artistSongs
                .map((s: any, idx: number) => {
                  const tr = mapSaavnSongToTrack(s, idx, isSlow);
                  if (tr) tr.isOfficialArtistTop = true;
                  return tr;
                })
                .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
              for (const t of moreTracks) {
                addTrack(t);
              }
            }
          }
        } catch (_) {}
      }

      // 2. Add JioSaavn Song Search tracks for current page
      if (saavnSongRes.status === 'fulfilled' && saavnSongRes.value && saavnSongRes.value.ok) {
        try {
          const json = await saavnSongRes.value.json();
          const results = json?.data?.results || [];
          const saavnTracks = results
            .map((s: any, idx: number) => mapSaavnSongToTrack(s, idx, isSlow))
            .filter((t: MusicTrack | null): t is MusicTrack => t !== null);
          for (const t of saavnTracks) {
            addTrack(t);
          }
        } catch (_) {}
      }

      // 3. Add YouTube Music tracks
      if (ytRes.status === 'fulfilled' && ytRes.value && ytRes.value.ok) {
        try {
          const ytList = await ytRes.value.json();
          if (Array.isArray(ytList)) {
            for (const item of ytList) {
              const t = mapYtSongToTrack(item, trimmed);
              if (t) addTrack(t);
            }
          }
        } catch (_) {}
      }

      // Умное ранжирование релевантности для локального поиска
      const qTokens = tokenize(trimmed);
      const scoreTrack = (t: MusicTrack): number => {
        let score = 0;
        const normA = normalizeStr(t.artist);
        const translitNormA = normalizeStr(transliterateRuToEn(t.artist));
        const normT = normalizeStr(t.title);
        const translitNormT = normalizeStr(transliterateRuToEn(t.title));
        const normAlb = normalizeStr(t.album || '');

        const aTokens = tokenize(t.artist);
        const tTokens = tokenize(t.title);

        if (t.isOfficialArtistTop) {
          score += 150;
        }

        const isExactArtist = normA === normQ || (aliasNormQ && normA === aliasNormQ) || translitNormA === normQ || normA === translitNormQ;
        if (isExactArtist) {
          score += 140;
        } else if (normA.startsWith(normQ) || normQ.startsWith(normA) || (aliasNormQ && normA.includes(aliasNormQ))) {
          score += 70;
        }

        const isExactTitle = normT === normQ || (aliasNormQ && normT === aliasNormQ) || translitNormT === normQ || normT === translitNormQ;
        if (isExactTitle) {
          score += 120;
        } else if (normT.startsWith(normQ) || normQ.startsWith(normT)) {
          score += 60;
        }

        if (qTokens.length > 0) {
          let matchedQTokens = 0;
          let matchedInArtist = 0;
          let matchedInTitle = 0;

          for (const qt of qTokens) {
            const translitQt = transliterateRuToEn(qt);
            const inA = aTokens.some(at => at === qt || at.startsWith(qt) || transliterateRuToEn(at) === qt || at === translitQt);
            const inT = tTokens.some(tt => tt === qt || tt.startsWith(qt) || transliterateRuToEn(tt) === qt || tt === translitQt);
            if (inA || inT) {
              matchedQTokens++;
              if (inA) matchedInArtist++;
              if (inT) matchedInTitle++;
            }
          }

          const coverage = matchedQTokens / qTokens.length;
          score += Math.round(coverage * 100);

          if (matchedInArtist > 0 && matchedInTitle > 0) {
            score += 120;
          }
        }

        if (normAlb === normQ || (aliasNormQ && normAlb === aliasNormQ)) {
          score += 20;
        }

        const junkRe = /\b(?:8-bit|16-bit|emulation|tribute|karaoke|ringtone|remix|cover|минус|караоке|кавер)\b/i;
        if (junkRe.test(t.title) || (t.album && junkRe.test(t.album))) {
          score -= 60;
        }

        if (typeof t.views === 'number' && t.views > 0) {
          if (t.views > 10000000) score += 30;
          else if (t.views > 1000000) score += 20;
          else if (t.views > 100000) score += 10;
        }

        return score;
      };

      const scoredTracks = merged.map(t => ({ track: t, score: scoreTrack(t) }));
      scoredTracks.sort((a, b) => b.score - a.score);
      const sliced = scoredTracks.slice(0, limit).map(item => item.track);
      if (sliced.length > 0) {
        clientCache.set(cacheKey, sliced, 86400); // 24 hours client cache с авто-очисткой
      }

      releaseInitialLoading();
      return sliced;
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal.aborted) {
        // Поиск отменён размонтированием компонента — это не ошибка
        releaseInitialLoading();
        return [];
      }
      console.warn('[MusicApi] Search failed:', err);
      setError(err?.message || 'Error searching tracks');
      releaseInitialLoading();
      return [];
    } finally {
      searchAbortsRef.current.delete(abortCtrl);
    }
  }, []);

  const searchAlbums = useCallback(async (query: string, limit = 12): Promise<MusicAlbum[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = `cache_music_albums_v1_${trimmed.toLowerCase()}_${limit}`;
    const cached = clientCache.get<MusicAlbum[]>(cacheKey) || await clientCache.getAsync<MusicAlbum[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    try {
      const encoded = encodeURIComponent(trimmed);
      const res = await saavnApiFetch(`search/albums?query=${encoded}&limit=${limit}`);
      if (!res || !res.ok) return [];

      const json = await res.json();
      const results = json?.data?.results || [];
      const albums: MusicAlbum[] = [];
      const seenTitles = new Set<string>();

      for (const a of results) {
        const title = decodeHtmlEntities(a.name || a.title || '');
        const artist = extractArtistName(a);
        const normKey = `${artist.toLowerCase()} - ${title.toLowerCase().replace(/\([^)]*\)/g, '').trim()}`;
        if (!title || seenTitles.has(normKey)) continue;
        seenTitles.add(normKey);

        const artworkUrl = extractArtwork(a.image);
        albums.push({
          id: String(a.id),
          title,
          artist,
          year: a.year ? String(a.year) : undefined,
          artworkUrl: artworkUrl || PLACEHOLDER_ARTWORK,
          songCount: typeof a.songCount === 'number' ? a.songCount : undefined
        });
      }

      if (albums.length > 0) {
        clientCache.set(cacheKey, albums, 86400);
      }
      return albums;
    } catch (err) {
      console.warn('[MusicApi] searchAlbums error:', err);
      return [];
    }
  }, []);

  const fetchAlbumTracks = useCallback(async (albumId: string): Promise<MusicTrack[]> => {
    if (!albumId) return [];

    const cacheKey = `cache_album_tracks_v1_${albumId}`;
    const cached = clientCache.get<MusicTrack[]>(cacheKey) || await clientCache.getAsync<MusicTrack[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }

    const { isSlow } = getNetworkSpeed();

    try {
      const res = await saavnApiFetch(`albums?id=${encodeURIComponent(albumId)}`);
      if (!res || !res.ok) return [];

      const json = await res.json();
      const songs = json?.data?.songs || [];
      const tracks: MusicTrack[] = songs
        .map((s: any, idx: number) => mapSaavnSongToTrack(s, idx, isSlow))
        .filter((t: MusicTrack | null): t is MusicTrack => t !== null);

      if (tracks.length > 0) {
        clientCache.set(cacheKey, tracks, 86400);
      }
      return tracks;
    } catch (err) {
      console.warn('[MusicApi] fetchAlbumTracks error:', err);
      return [];
    }
  }, []);

  return {
    loading,
    error,
    searchMusic,
    searchAlbums,
    fetchAlbumTracks,
    resolveFullAudioUrl
  };
}
