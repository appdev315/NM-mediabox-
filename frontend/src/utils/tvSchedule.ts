// Движок детерминированной сетки вещания MediaBox TV (Pseudo-Linear FAST TV)
// Архитектура: 19 жанров фильмов (по 100 тайтлов TMDB по рейтингу) + 16 очередей сериалов.
// 10 слотов вещания в сутки (слоты по 144 мин), взвешенный Dayparting (Tier 1 прайм, Tier 2 день, Tier 3 ночь/утро),
// ежемесячная динамическая ротация (Monthly Rotation Shift) и сквозной прогон сезонов сериалов.
// Сложность: O(1) без запросов к серверу, строго синхронно для всех пользователей.

import {
  CATALOG_NEW_RELEASES,
  CATALOG_POPULAR,
  CATALOG_ACTION,
  CATALOG_COMEDY,
  CATALOG_SCIFI,
  CATALOG_THRILLER,
  CATALOG_DETECTIVE,
  CATALOG_HORROR,
  CATALOG_ANIMATION,
  CATALOG_DRAMA,
  CATALOG_CRIME,
  CATALOG_ROMANCE,
  CATALOG_ADVENTURE,
  CATALOG_FANTASY,
  CATALOG_FAMILY,
  CATALOG_DOCUMENTARY,
  CATALOG_HISTORY,
  CATALOG_WAR,
  CATALOG_MUSIC,
  CATALOG_WESTERN
} from './tvCatalogData';

export interface TvPlaylistItem {
  id: number; // TMDB ID
  title: string;
  origin_title?: string;
  year: string;
  type: 'movie' | 'tv';
  durationSec: number;
  posterPath: string;
  season?: string;
  episode?: string;
  episodeTitle?: string;
}

export interface SeriesDefinition {
  id: number;
  title: string;
  originTitle: string;
  year: string;
  posterPath: string;
  seasons: number[]; // Число эпизодов в каждом сезоне [сезон 1, сезон 2, ...]
  epDurationSec?: number;
}

export interface TvChannel {
  id: string;
  category: 'movies' | 'series';
  genreNameRu: string;
  genreNameEn: string;
  nameRu: string;
  nameEn: string;
  icon: string;
  color: string;
  // Индивидуальный фазовый сдвиг сетки канала в секундах для устранения совпадений эфира
  phaseOffsetSec?: number;
  moviePool?: TvPlaylistItem[];
  seriesEpisodes?: TvPlaylistItem[];
  weeklyPool?: TvPlaylistItem[];
}

export interface ChannelScheduleState {
  channel: TvChannel;
  currentItem: TvPlaylistItem;
  initialTimecode: number;
  elapsedSec: number;
  remainingSec: number;
  durationSec: number;
  progressPercent: number;
  nextItem: TvPlaylistItem;
  nextStartTime: number;
  formattedElapsed: string;
  formattedDuration: string;
  formattedTimeRemaining: string;
  formattedNextTime: string;
  slotIndex: number; // индекс текущего тайтла в пуле канала (порядковый номер эфира в цикле)
  dayOfWeek: number; // 0..6 (Пн..Вс)
}

// Генератор непрерывной цепочки эпизодов для очередей сериалов.
// После финала последнего сезона первого сериала автоматически запускается S01E01 следующего сериала очереди.
function generateSeriesQueueEpisodes(seriesList: SeriesDefinition[], defaultEpDuration = 3000): TvPlaylistItem[] {
  const result: TvPlaylistItem[] = [];

  for (const s of seriesList) {
    s.seasons.forEach((epCount, sIdx) => {
      const seasonNum = sIdx + 1;
      for (let ep = 1; ep <= epCount; ep++) {
        result.push({
          id: s.id,
          title: s.title,
          origin_title: s.originTitle,
          year: s.year,
          type: 'tv',
          season: String(seasonNum),
          episode: String(ep),
          episodeTitle: `Сезон ${seasonNum}, Серия ${ep}`,
          durationSec: s.epDurationSec || defaultEpDuration,
          posterPath: s.posterPath
        });
      }
    });
  }

  if (result.length === 0) {
    result.push({
      id: 1396,
      title: 'Во все тяжкие',
      origin_title: 'Breaking Bad',
      year: '2008',
      type: 'tv',
      season: '1',
      episode: '1',
      episodeTitle: 'Сезон 1, Серия 1',
      durationSec: 2880,
      posterPath: '/gwB6E7Zi5L3J9WA2y0zLeKuc3ul.jpg'
    });
  }

  return result;
}

// РЕЕСТР КАНАЛОВ MEDIABOX TV (20 КАНАЛОВ ФИЛЬМОВ + 16 КАНАЛОВ СЕРИАЛОВ)
export const TV_CHANNELS: TvChannel[] = [
  // ================= 20 КАНАЛОВ ФИЛЬМОВ (НОВИНКИ + 19 ЖАНРОВ ПО 100 ТАЙТЛОВ ИЗ TMDB) =================
  {
    id: 'ch-new',
    category: 'movies',
    genreNameRu: 'Новинки',
    genreNameEn: 'New Releases',
    nameRu: 'Новинки ТВ',
    nameEn: 'New Releases TV',
    icon: '',
    color: 'from-amber-400 via-rose-500 to-purple-600',
    phaseOffsetSec: 0,
    moviePool: CATALOG_NEW_RELEASES
  },
  {
    id: 'ch-popular',
    category: 'movies',
    genreNameRu: 'Топ 100',
    genreNameEn: 'Top 100',
    nameRu: 'Топ 100 ТВ',
    nameEn: 'Top 100 TV',
    icon: '',
    color: 'from-amber-500 to-orange-600',
    phaseOffsetSec: 7200,
    moviePool: CATALOG_POPULAR
  },
  {
    id: 'ch-action',
    category: 'movies',
    genreNameRu: 'Боевики',
    genreNameEn: 'Action',
    nameRu: 'Боевик ТВ',
    nameEn: 'Action TV',
    icon: '',
    color: 'from-orange-600 to-red-600',
    moviePool: CATALOG_ACTION
  },
  {
    id: 'ch-comedy',
    category: 'movies',
    genreNameRu: 'Комедии',
    genreNameEn: 'Comedy',
    nameRu: 'Комедия ТВ',
    nameEn: 'Comedy TV',
    icon: '',
    color: 'from-amber-500 to-yellow-500',
    moviePool: CATALOG_COMEDY
  },
  {
    id: 'ch-scifi',
    category: 'movies',
    genreNameRu: 'Фантастика',
    genreNameEn: 'Sci-Fi',
    nameRu: 'Фантастика ТВ',
    nameEn: 'Sci-Fi TV',
    icon: '',
    color: 'from-blue-600 to-indigo-600',
    moviePool: CATALOG_SCIFI
  },
  {
    id: 'ch-thriller',
    category: 'movies',
    genreNameRu: 'Триллеры',
    genreNameEn: 'Thriller',
    nameRu: 'Триллер ТВ',
    nameEn: 'Thriller TV',
    icon: '',
    color: 'from-purple-700 to-slate-900',
    moviePool: CATALOG_THRILLER
  },
  {
    id: 'ch-detective',
    category: 'movies',
    genreNameRu: 'Детективы',
    genreNameEn: 'Detective',
    nameRu: 'Детектив ТВ',
    nameEn: 'Detective TV',
    icon: '',
    color: 'from-violet-900 to-slate-900',
    moviePool: CATALOG_DETECTIVE
  },
  {
    id: 'ch-horror',
    category: 'movies',
    genreNameRu: 'Ужасы',
    genreNameEn: 'Horror',
    nameRu: 'Ужасы ТВ',
    nameEn: 'Horror TV',
    icon: '',
    color: 'from-red-900 to-black',
    moviePool: CATALOG_HORROR
  },
  {
    id: 'ch-animation',
    category: 'movies',
    genreNameRu: 'Мультфильмы',
    genreNameEn: 'Animation',
    nameRu: 'Мульт ТВ',
    nameEn: 'Animation TV',
    icon: '',
    color: 'from-emerald-500 to-teal-600',
    moviePool: CATALOG_ANIMATION
  },
  {
    id: 'ch-drama',
    category: 'movies',
    genreNameRu: 'Драмы',
    genreNameEn: 'Drama',
    nameRu: 'Драма ТВ',
    nameEn: 'Drama TV',
    icon: '',
    color: 'from-rose-800 to-pink-950',
    moviePool: CATALOG_DRAMA
  },
  {
    id: 'ch-crime',
    category: 'movies',
    genreNameRu: 'Криминал',
    genreNameEn: 'Crime',
    nameRu: 'Криминал ТВ',
    nameEn: 'Crime TV',
    icon: '',
    color: 'from-zinc-700 to-neutral-900',
    moviePool: CATALOG_CRIME
  },
  {
    id: 'ch-romance',
    category: 'movies',
    genreNameRu: 'Мелодрамы',
    genreNameEn: 'Romance',
    nameRu: 'Мелодрама ТВ',
    nameEn: 'Romance TV',
    icon: '',
    color: 'from-pink-600 to-rose-700',
    moviePool: CATALOG_ROMANCE
  },
  {
    id: 'ch-adventure',
    category: 'movies',
    genreNameRu: 'Приключения',
    genreNameEn: 'Adventure',
    nameRu: 'Приключения ТВ',
    nameEn: 'Adventure TV',
    icon: '',
    color: 'from-cyan-600 to-blue-700',
    moviePool: CATALOG_ADVENTURE
  },
  {
    id: 'ch-fantasy',
    category: 'movies',
    genreNameRu: 'Фэнтези',
    genreNameEn: 'Fantasy',
    nameRu: 'Фэнтези ТВ',
    nameEn: 'Fantasy TV',
    icon: '',
    color: 'from-indigo-700 to-purple-800',
    moviePool: CATALOG_FANTASY
  },
  {
    id: 'ch-family',
    category: 'movies',
    genreNameRu: 'Семейные',
    genreNameEn: 'Family',
    nameRu: 'Семейное ТВ',
    nameEn: 'Family TV',
    icon: '',
    color: 'from-sky-600 to-teal-700',
    moviePool: CATALOG_FAMILY
  },
  {
    id: 'ch-documentary',
    category: 'movies',
    genreNameRu: 'Документальные',
    genreNameEn: 'Documentary',
    nameRu: 'Документальное ТВ',
    nameEn: 'Documentary TV',
    icon: '',
    color: 'from-emerald-700 to-cyan-900',
    moviePool: CATALOG_DOCUMENTARY
  },
  {
    id: 'ch-history',
    category: 'movies',
    genreNameRu: 'Исторические',
    genreNameEn: 'History',
    nameRu: 'Историческое ТВ',
    nameEn: 'History TV',
    icon: '',
    color: 'from-amber-800 to-stone-900',
    moviePool: CATALOG_HISTORY
  },
  {
    id: 'ch-war',
    category: 'movies',
    genreNameRu: 'Военные',
    genreNameEn: 'War',
    nameRu: 'Военное ТВ',
    nameEn: 'War TV',
    icon: '',
    color: 'from-stone-700 to-zinc-950',
    moviePool: CATALOG_WAR
  },
  {
    id: 'ch-music',
    category: 'movies',
    genreNameRu: 'Музыкальные',
    genreNameEn: 'Music',
    nameRu: 'Музыкальное ТВ',
    nameEn: 'Music TV',
    icon: '',
    color: 'from-fuchsia-600 to-purple-900',
    moviePool: CATALOG_MUSIC
  },
  {
    id: 'ch-western',
    category: 'movies',
    genreNameRu: 'Вестерны',
    genreNameEn: 'Western',
    nameRu: 'Вестерн ТВ',
    nameEn: 'Western TV',
    icon: '',
    color: 'from-amber-700 to-yellow-950',
    moviePool: CATALOG_WESTERN
  },

  // ================= 16 КАНАЛОВ СЕРИАЛОВ (СКВОЗНЫЕ ОЧЕРЕДИ СЕЗОНОВ) =================
  {
    id: 'ch-series-dorama',
    category: 'series',
    genreNameRu: 'Дорамы',
    genreNameEn: 'Dorama & K-Drama',
    nameRu: 'Дорама ТВ',
    nameEn: 'Dorama TV',
    icon: '',
    color: 'from-pink-500 to-rose-700',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 94796, title: 'Аварийная посадка любви', originTitle: 'Crash Landing on You', year: '2019', posterPath: '/kHq1u6L3gX39a04Wq82Vq8G352o.jpg', seasons: [16], epDurationSec: 4200 },
      { id: 67915, title: 'Гоблин / Демон', originTitle: 'Guardian: The Lonely and Great God', year: '2016', posterPath: '/v4f25P6YgDcx8018h2LgOqK0iU3.jpg', seasons: [16], epDurationSec: 4200 },
      { id: 117376, title: 'Винченцо', originTitle: 'Vincenzo', year: '2021', posterPath: '/dvXJgEDQXqLqWd58oD4lE2i6q5F.jpg', seasons: [20], epDurationSec: 4500 },
      { id: 99966, title: 'Мы все мертвы', originTitle: 'All of Us Are Dead', year: '2022', posterPath: '/7PIItwy2Eby1z7jruewAeMH9NaL.jpg', seasons: [12], epDurationSec: 3600 },
      { id: 154825, title: 'Деловое предложение', originTitle: 'Business Proposal', year: '2022', posterPath: '/ahsZ2kLzSAMDXVb8fZoVLScWsHS.jpg', seasons: [12], epDurationSec: 3600 },
      { id: 136283, title: 'Слава', originTitle: 'The Glory', year: '2022', posterPath: '/dbuIoJKnnAFGof9imZ9UFa3O42S.jpg', seasons: [16], epDurationSec: 3300 },
      { id: 96162, title: 'Итхэвонский класс', originTitle: 'Itaewon Class', year: '2020', posterPath: '/2tTMci6Hq99gkagpYe19RulNXRr.jpg', seasons: [16], epDurationSec: 3900 }
    ])
  },
  {
    id: 'ch-series-anime',
    category: 'series',
    genreNameRu: 'Аниме',
    genreNameEn: 'Anime Series',
    nameRu: 'Аниме ТВ',
    nameEn: 'Anime TV',
    icon: '',
    color: 'from-violet-600 to-indigo-800',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 85937, title: 'Клинок, рассекающий демонов', originTitle: 'Demon Slayer: Kimetsu no Yaiba', year: '2019', posterPath: '/wrCVHknDaBW7usMiHG9fGRKGKOa.jpg', seasons: [26, 11, 11, 8], epDurationSec: 1500 },
      { id: 1429, title: 'Атака титанов', originTitle: 'Attack on Titan', year: '2013', posterPath: '/hTP1DtLGFamjfu8WqjnuQdP1n4i.jpg', seasons: [25, 12, 22, 28], epDurationSec: 1500 },
      { id: 95479, title: 'Магическая битва', originTitle: 'Jujutsu Kaisen', year: '2020', posterPath: '/fHpKW7qQ9c8pWdZ3314gU2P1s6q.jpg', seasons: [24, 23], epDurationSec: 1500 },
      { id: 13916, title: 'Тетрадь смерти', originTitle: 'Death Note', year: '2006', posterPath: '/yzTD7P7dmZRxAQjoNxC1GxOLRiH.jpg', seasons: [37], epDurationSec: 1400 },
      { id: 114410, title: 'Человек-бензопила', originTitle: 'Chainsaw Man', year: '2022', posterPath: '/npHNjld2VT0v6HGwSpW9191d8s.jpg', seasons: [12], epDurationSec: 1500 }
    ])
  },
  {
    id: 'ch-series-popular',
    category: 'series',
    genreNameRu: 'Популярное',
    genreNameEn: 'Popular Series',
    nameRu: 'Популярные сериалы ТВ',
    nameEn: 'Popular Series TV',
    icon: '',
    color: 'from-amber-600 to-red-600',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 100088, title: 'Одни из нас', originTitle: 'The Last of Us', year: '2023', posterPath: '/69loIrm9JPpPRE3Akw4yRoitSYn.jpg', seasons: [9], epDurationSec: 3600 },
      { id: 93405, title: 'Игра в кальмара', originTitle: 'Squid Game', year: '2021', posterPath: '/6zHKgCKht3vwrtSXFvSUntSRsJh.jpg', seasons: [9, 6], epDurationSec: 3300 },
      { id: 119051, title: 'Уэнздей', originTitle: 'Wednesday', year: '2022', posterPath: '/lx7ipUuzHmbOa1qzMPj4ypZ7A8u.jpg', seasons: [8], epDurationSec: 3000 }
    ])
  },
  {
    id: 'ch-series-action',
    category: 'series',
    genreNameRu: 'Боевики',
    genreNameEn: 'Action Series',
    nameRu: 'Боевики сериалы ТВ',
    nameEn: 'Action Series TV',
    icon: '',
    color: 'from-red-600 to-rose-900',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 61889, title: 'Сорвиголова', originTitle: 'Daredevil', year: '2015', posterPath: '/QWbPaDxiB6LW2vllhgPhknX2fD.jpg', seasons: [13, 13, 13], epDurationSec: 3200 },
      { id: 67178, title: 'Каратель', originTitle: 'The Punisher', year: '2017', posterPath: '/sO2p6x139kP3fT1xS210jK5k8B4.jpg', seasons: [13, 13], epDurationSec: 3100 },
      { id: 108978, title: 'Ричер', originTitle: 'Reacher', year: '2022', posterPath: '/zLqlW0rXmHwOZRhmOjeod14sGiT.jpg', seasons: [8, 8, 8, 8], epDurationSec: 3000 },
      { id: 41727, title: 'Банши', originTitle: 'Banshee', year: '2013', posterPath: '/1FS2Oj1mXBDNif6MuifULdGVU6w.jpg', seasons: [10, 10, 10, 8], epDurationSec: 3300 }
    ])
  },
  {
    id: 'ch-series-comedy',
    category: 'series',
    genreNameRu: 'Комедии',
    genreNameEn: 'Comedy Series',
    nameRu: 'Комедийные сериалы ТВ',
    nameEn: 'Comedy Series TV',
    icon: '',
    color: 'from-amber-500 to-yellow-500',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 1668, title: 'Друзья', originTitle: 'Friends', year: '1994', posterPath: '/zBOs8S3UOHyWLzOl9gF8lknBxlL.jpg', seasons: [24, 24, 25, 24, 24, 25, 24, 24, 24, 18], epDurationSec: 1500 },
      { id: 2316, title: 'Офис', originTitle: 'The Office', year: '2005', posterPath: '/zjW7g5PGsJMy7pIr0hKdBKWcH9V.jpg', seasons: [6, 22, 25, 19, 28, 26, 26, 24, 25], epDurationSec: 1500 },
      { id: 48891, title: 'Бруклин 9-9', originTitle: 'Brooklyn Nine-Nine', year: '2013', posterPath: '/77mEUuM28cSV8YSn4EcF3koRHHT.jpg', seasons: [22, 23, 23, 22, 22, 18, 13, 10], epDurationSec: 1500 }
    ])
  },
  {
    id: 'ch-series-crime',
    category: 'series',
    genreNameRu: 'Криминал',
    genreNameEn: 'Crime Series',
    nameRu: 'Криминальные сериалы ТВ',
    nameEn: 'Crime Series TV',
    icon: '',
    color: 'from-emerald-700 to-lime-600',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 1396, title: 'Во все тяжкие', originTitle: 'Breaking Bad', year: '2008', posterPath: '/gwB6E7Zi5L3J9WA2y0zLeKuc3ul.jpg', seasons: [7, 13, 13, 13, 16], epDurationSec: 2880 },
      { id: 71694, title: 'Снегопад', originTitle: 'Snowfall', year: '2017', posterPath: '/bgSvSxnu7seQrfnlLEAStcJZBbx.jpg', seasons: [10, 10, 10, 10, 10, 10], epDurationSec: 2700 },
      { id: 60059, title: 'Лучше звоните Солу', originTitle: 'Better Call Saul', year: '2015', posterPath: '/o2jgxiP6PNaZQzlql8DgouwTBvz.jpg', seasons: [10, 10, 10, 10, 10, 13], epDurationSec: 3000 },
      { id: 1438, title: 'Прослушка', originTitle: 'The Wire', year: '2002', posterPath: '/aoy6XphJtLvCfVmLFqBLaR56BAW.jpg', seasons: [13, 12, 12, 13, 10], epDurationSec: 3600 }
    ])
  },
  {
    id: 'ch-series-gangster',
    category: 'series',
    genreNameRu: 'Гангстеры',
    genreNameEn: 'Gangster Series',
    nameRu: 'Гангстерские сериалы ТВ',
    nameEn: 'Gangster Series TV',
    icon: '',
    color: 'from-slate-800 to-amber-950',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 60574, title: 'Острые козырьки', originTitle: 'Peaky Blinders', year: '2013', posterPath: '/pVJzfWgb3sHN29hLaiI5jmBN9vx.jpg', seasons: [6, 6, 6, 6, 6, 6], epDurationSec: 3420 },
      { id: 1398, title: 'Сопрано', originTitle: 'The Sopranos', year: '1999', posterPath: '/l7kBNxisz66jJApaa82WxqjtKbb.jpg', seasons: [13, 13, 13, 13, 13, 21], epDurationSec: 3300 },
      { id: 1621, title: 'Подпольная империя', originTitle: 'Boardwalk Empire', year: '2010', posterPath: '/bVUUXRKGaEslWrIrCTOLB7WzxbT.jpg', seasons: [12, 12, 12, 12, 8], epDurationSec: 3400 }
    ])
  },
  {
    id: 'ch-series-scifi',
    category: 'series',
    genreNameRu: 'Фантастика',
    genreNameEn: 'Sci-Fi Series',
    nameRu: 'Фантастические сериалы ТВ',
    nameEn: 'Sci-Fi Series TV',
    icon: '',
    color: 'from-blue-700 to-indigo-900',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 66732, title: 'Очень странные дела', originTitle: 'Stranger Things', year: '2016', posterPath: '/nW3cral1e2r3xfLySPE1U9bailS.jpg', seasons: [8, 9, 8, 9], epDurationSec: 3120 },
      { id: 76479, title: 'Пацаны', originTitle: 'The Boys', year: '2019', posterPath: '/3NqlBDpWI83TgQ9nmeFwTVxEmtZ.jpg', seasons: [8, 8, 8, 8], epDurationSec: 3600 },
      { id: 82856, title: 'Мандалорец', originTitle: 'The Mandalorian', year: '2019', posterPath: '/3JcJfU9wm6sA2R6LQtnsBJsHMmY.jpg', seasons: [8, 8, 8], epDurationSec: 2500 }
    ])
  },
  {
    id: 'ch-series-medical',
    category: 'series',
    genreNameRu: 'Медицина',
    genreNameEn: 'Medical Series',
    nameRu: 'Медицинские сериалы ТВ',
    nameEn: 'Medical Series TV',
    icon: '',
    color: 'from-cyan-800 to-blue-950',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 1408, title: 'Доктор Хаус', originTitle: 'House', year: '2004', posterPath: '/3Cz7ySOQJmqiuTdrc6CY0r65yDI.jpg', seasons: [22, 24, 24, 16, 24, 22, 23, 22], epDurationSec: 2640 },
      { id: 71712, title: 'Хороший доктор', originTitle: 'The Good Doctor', year: '2017', posterPath: '/c3WPgJl5OjAMJotI7qPeL1zgcCX.jpg', seasons: [18, 18, 20, 20, 18, 22, 10], epDurationSec: 2520 }
    ])
  },
  {
    id: 'ch-series-detective',
    category: 'series',
    genreNameRu: 'Детективы',
    genreNameEn: 'Detective Series',
    nameRu: 'Детективные сериалы ТВ',
    nameEn: 'Detective Series TV',
    icon: '',
    color: 'from-violet-900 to-slate-900',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 19885, title: 'Шерлок', originTitle: 'Sherlock', year: '2010', posterPath: '/7WTsnHkbA0FaG6R9twfFde0I9hl.jpg', seasons: [3, 3, 3, 3], epDurationSec: 5400 },
      { id: 46648, title: 'Настоящий детектив', originTitle: 'True Detective', year: '2014', posterPath: '/1p60ehq2diow72QQC8pyppfexky.jpg', seasons: [8, 8, 8, 6], epDurationSec: 3600 },
      { id: 67744, title: 'Охотник за разумом', originTitle: 'MINDHUNTER', year: '2017', posterPath: '/tEBOVb1ZGT5XapLn5YLXk3Msr8N.jpg', seasons: [10, 9], epDurationSec: 3300 }
    ])
  },
  {
    id: 'ch-series-drama',
    category: 'series',
    genreNameRu: 'Драмы',
    genreNameEn: 'Drama Series',
    nameRu: 'Драматические сериалы ТВ',
    nameEn: 'Drama Series TV',
    icon: '',
    color: 'from-rose-800 to-purple-950',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 87108, title: 'Чернобыль', originTitle: 'Chernobyl', year: '2019', posterPath: '/qhzSVp06AGGcziMoibInZ5PY0Eg.jpg', seasons: [5], epDurationSec: 3600 },
      { id: 76331, title: 'Наследники', originTitle: 'Succession', year: '2018', posterPath: '/5vZjUwl2NxNJY2cH7e8tmXdIjBA.jpg', seasons: [10, 10, 9, 10], epDurationSec: 3600 },
      { id: 65494, title: 'Корона', originTitle: 'The Crown', year: '2016', posterPath: '/1fgswE7VWpGQPD68DUFx6KPnWWa.jpg', seasons: [10, 10, 10, 10, 10, 10], epDurationSec: 3400 }
    ])
  },
  {
    id: 'ch-series-fantasy',
    category: 'series',
    genreNameRu: 'Фэнтези',
    genreNameEn: 'Fantasy Series',
    nameRu: 'Фэнтези сериалы ТВ',
    nameEn: 'Fantasy Series TV',
    icon: '',
    color: 'from-purple-800 to-amber-950',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 1399, title: 'Игра Престолов', originTitle: 'Game of Thrones', year: '2011', posterPath: '/1sIAsLSaMwm3mb7Y6jISMv56McR.jpg', seasons: [10, 10, 10, 10, 10, 10, 7, 6], epDurationSec: 3400 },
      { id: 94997, title: 'Дом Дракона', originTitle: 'House of the Dragon', year: '2022', posterPath: '/hXyYN6LFo7QnKUA3QBx7B3KsnJE.jpg', seasons: [10, 8], epDurationSec: 3600 },
      { id: 71912, title: 'Ведьмак', originTitle: 'The Witcher', year: '2019', posterPath: '/rY2c2LhN07CRKlAbRaDZxN2XjvK.jpg', seasons: [8, 8, 8], epDurationSec: 3300 }
    ])
  },
  {
    id: 'ch-series-history',
    category: 'series',
    genreNameRu: 'История',
    genreNameEn: 'History Series',
    nameRu: 'Исторические сериалы ТВ',
    nameEn: 'History Series TV',
    icon: '',
    color: 'from-amber-800 to-stone-900',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 1807, title: 'Рим', originTitle: 'Rome', year: '2005', posterPath: '/hoowzozsn0XQGtgH8nyivAMZfPN.jpg', seasons: [12, 10], epDurationSec: 3300 },
      { id: 44217, title: 'Викинги', originTitle: 'Vikings', year: '2013', posterPath: '/1de3R902B5EEMmohBQsExd5V87Y.jpg', seasons: [9, 10, 10, 20, 20, 20], epDurationSec: 2800 },
      { id: 1425, title: 'Карточный домик', originTitle: 'House of Cards', year: '2013', posterPath: '/ffsZwNarxYv9br5DyslkBXFspgp.jpg', seasons: [13, 13, 13, 13, 13, 8], epDurationSec: 3300 }
    ])
  },
  {
    id: 'ch-series-romance',
    category: 'series',
    genreNameRu: 'Мелодрамы',
    genreNameEn: 'Romance Series',
    nameRu: 'Романтические сериалы ТВ',
    nameEn: 'Romance Series TV',
    icon: '',
    color: 'from-pink-600 to-rose-900',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 91239, title: 'Бриджертоны', originTitle: 'Bridgerton', year: '2020', posterPath: '/o3wfK8LeHnFj560M5Gs8ZOg57Lo.jpg', seasons: [8, 8, 8], epDurationSec: 3600 },
      { id: 93812, title: 'Нормальные люди', originTitle: 'Normal People', year: '2020', posterPath: '/7sbuKNu7vdSUH95HneuPlRu6Tnh.jpg', seasons: [12], epDurationSec: 1800 },
      { id: 56570, title: 'Чужестранка', originTitle: 'Outlander', year: '2014', posterPath: '/yHeEKtVZFinHMMuj9zEOeSYosoS.jpg', seasons: [16, 13, 13, 13, 12, 8, 16], epDurationSec: 3600 }
    ])
  },
  {
    id: 'ch-series-doc',
    category: 'series',
    genreNameRu: 'Документальные',
    genreNameEn: 'Documentary Series',
    nameRu: 'Документальные сериалы ТВ',
    nameEn: 'Documentary Series TV',
    icon: '',
    color: 'from-teal-700 to-cyan-900',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 83880, title: 'Наша планета', originTitle: 'Our Planet', year: '2019', posterPath: '/65SESUs3ZO31p3N9VfymO8C5oCv.jpg', seasons: [8, 4], epDurationSec: 3000 },
      { id: 79525, title: 'Последний танец', originTitle: 'The Last Dance', year: '2020', posterPath: '/bpYvXRmgB8Kd9LZQ2xB4DD7Ejzj.jpg', seasons: [10], epDurationSec: 3000 },
      { id: 58474, title: 'Космос: Пространство и время', originTitle: 'Cosmos: A Spacetime Odyssey', year: '2014', posterPath: '/vReLRjDV9XPhiOSEW7QWow4DXwf.jpg', seasons: [13], epDurationSec: 2700 }
    ])
  },
  {
    id: 'ch-series-family',
    category: 'series',
    genreNameRu: 'Семейные',
    genreNameEn: 'Family Series',
    nameRu: 'Семейные сериалы ТВ',
    nameEn: 'Family Series TV',
    icon: '',
    color: 'from-sky-600 to-indigo-700',
    seriesEpisodes: generateSeriesQueueEpisodes([
      { id: 77169, title: 'Кобра Кай', originTitle: 'Cobra Kai', year: '2018', posterPath: '/5z5HNOfP225TCZLjeeQ2mKyyjVa.jpg', seasons: [10, 10, 10, 10, 10, 15], epDurationSec: 2100 },
      { id: 2004, title: 'Малкольм в центре внимания', originTitle: 'Malcolm in the Middle', year: '2000', posterPath: '/tuskpLz1wWwDKxdQR9Ih7o47dcV.jpg', seasons: [16, 25, 22, 22, 22, 22, 22], epDurationSec: 1300 },
      { id: 70785, title: 'Энн', originTitle: 'Anne with an E', year: '2017', posterPath: '/2CWfSle6I5vbDjJW991Up9rXrPr.jpg', seasons: [7, 10, 10], epDurationSec: 2600 }
    ])
  }
];

// Получить список ровно из 10 передач на конкретный день недели.
// ДЛЯ ФИЛЬМОВ (Dayparting Rating-Tiered + Monthly Rotation):
// 100 фильмов ранжированы по рейтингу:
// - Tier 1 (Топ 1–30 по рейтингу): Прайм-тайм эфир (вечер, слоты 7, 8, 9)
// - Tier 2 (Топ 31–70): Дневной эфир (слоты 3, 4, 5, 6)
// - Tier 3 (Топ 71–100): Ночной и утренний эфир (слоты 0, 1, 2)
// Ротация циклически смещается каждый день недели и каждый месяц (monthShift),
// гарантируя разнообразие прайм-тайма и нулевое зависание одних и тех же фильмов.
// Опорная эпоха глобальной синхронизации непрерывного вещания (2025-01-01 00:00:00 UTC)
// Гарантирует абсолютную идентичность эфира секунда-в-секунду для всех зрителей во всем мире
export const EPOCH_ANCHOR_SEC = 1735689600;

// Извлечение упорядоченного пула тайтлов телеканала
export function getChannelPool(channel: TvChannel): TvPlaylistItem[] {
  if (channel.category === 'series') {
    return channel.seriesEpisodes || channel.weeklyPool || [];
  }
  return channel.moviePool || channel.weeklyPool || [];
}

// Форматирование секунд в ММ:СС или ЧЧ:ММ:СС
export function formatTimecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Форматирование времени в ЧЧ:ММ
export function formatClockTime(timestampSec: number): string {
  const d = new Date(timestampSec * 1000);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Локализованное «осталось X ч Y мин» (ранее строка была зашита на русском для всех языков)
export function formatTimeRemaining(sec: number, language?: string): string {
  const remMinutes = Math.ceil(Math.max(0, sec) / 60);
  const lang = (language || 'ru').toLowerCase();
  const isRu = lang.startsWith('ru');
  const hours = Math.floor(remMinutes / 60);
  const mins = remMinutes % 60;
  if (remMinutes >= 60) {
    if (isRu) return `осталось ${hours} ч ${mins} мин`;
    if (lang.startsWith('es')) return `quedan ${hours} h ${mins} min`;
    if (lang.startsWith('fr')) return `restant ${hours} h ${mins} min`;
    if (lang.startsWith('de')) return `übrig ${hours} h ${mins} min`;
    if (lang.startsWith('id')) return `tersisa ${hours} j ${mins}mnt`;
    return `left ${hours} h ${mins} min`;
  }
  if (isRu) return `осталось ${remMinutes} мин`;
  if (lang.startsWith('es')) return `quedan ${remMinutes} min`;
  if (lang.startsWith('fr')) return `restant ${remMinutes} min`;
  if (lang.startsWith('de')) return `übrig ${remMinutes} min`;
  if (lang.startsWith('id')) return `tersisa ${remMinutes} mnt`;
  return `left ${remMinutes} min`;
}

// Детерминированный фазовый сдвиг расписания канала:
// Гарантирует уникальное время старта передач и отсутствие синхронных совпадений между каналами
export function getChannelPhaseOffset(channel: TvChannel): number {
  if (channel.phaseOffsetSec !== undefined) return channel.phaseOffsetSec;
  let hash = 0;
  for (let i = 0; i < channel.id.length; i++) {
    hash = (hash * 31 + channel.id.charCodeAt(i)) >>> 0;
  }
  return (hash % 100) * 3600;
}

// Получить список передач на конкретный день недели с полным суточным заполнением без повторов
export function getDayItemsForChannel(
  channel: TvChannel, 
  dayOfWeek: number, 
  weekNumber = 0
): TvPlaylistItem[] {
  const pool = getChannelPool(channel);
  if (pool.length === 0) return [];
  const safeDay = ((dayOfWeek % 7) + 7) % 7;
  const itemsPerDay = channel.category === 'series' ? 10 : 12;
  const startIndex = (weekNumber * (itemsPerDay * 7) + safeDay * itemsPerDay) % pool.length;
  const items: TvPlaylistItem[] = [];
  for (let i = 0; i < itemsPerDay; i++) {
    items.push(pool[(startIndex + i) % pool.length]);
  }
  return items;
}

// Расчёт текущего состояния прямого эфира (еженедельная суточная ротация с Dayparting)
export function getChannelScheduleState(
  channel: TvChannel, 
  language?: string,
  currentTimestampSec?: number
): ChannelScheduleState {
  const now = currentTimestampSec ?? Math.floor(Date.now() / 1000);
  const pool = getChannelPool(channel);

  // Страховочный fallback при пустом пуле
  if (pool.length === 0) {
    const dummy: TvPlaylistItem = {
      id: 278,
      title: 'Побег из Шоушенка',
      origin_title: 'The Shawshank Redemption',
      year: '1994',
      type: 'movie',
      durationSec: 8280,
      posterPath: '/yvmKPlTIi0xdcFQIFcQKQJcI63W.jpg'
    };
    return {
      channel,
      currentItem: dummy,
      initialTimecode: 0,
      elapsedSec: 0,
      remainingSec: 8280,
      durationSec: 8280,
      progressPercent: 0,
      nextItem: dummy,
      nextStartTime: now + 8280,
      formattedElapsed: '0:00',
      formattedDuration: '2:18:00',
      formattedTimeRemaining: formatTimeRemaining(8280, language),
      formattedNextTime: formatClockTime(now + 8280),
      slotIndex: 0,
      dayOfWeek: 0
    };
  }

  const d = new Date(now * 1000);
  const dayOfWeek = (d.getDay() + 6) % 7; // 0 = Пн ... 6 = Вс

  // Непрерывный сквозной прогон по всему пулу (для 100 фильмов полный цикл ~8.3 суток без единого повтора; для сериалов до 590 серий)
  let totalCycleDurationSec = 0;
  const defaultDuration = channel.category === 'series' ? 2700 : 7200;
  for (let i = 0; i < pool.length; i++) {
    totalCycleDurationSec += (pool[i].durationSec || defaultDuration);
  }
  if (totalCycleDurationSec === 0) totalCycleDurationSec = pool.length * defaultDuration;

  const channelOffset = getChannelPhaseOffset(channel);
  const elapsedSinceEpoch = (now - EPOCH_ANCHOR_SEC) - channelOffset;
  const offsetInCycle = ((elapsedSinceEpoch % totalCycleDurationSec) + totalCycleDurationSec) % totalCycleDurationSec;

  let accumulatedSec = 0;
  let currentIndex = 0;
  let elapsedInItem = 0;

  for (let i = 0; i < pool.length; i++) {
    const itemDuration = pool[i].durationSec || defaultDuration;
    if (offsetInCycle < accumulatedSec + itemDuration) {
      currentIndex = i;
      elapsedInItem = offsetInCycle - accumulatedSec;
      break;
    }
    accumulatedSec += itemDuration;
  }

  const currentItem = pool[currentIndex];
  const durationSec = currentItem.durationSec || defaultDuration;
  const elapsedSec = Math.max(0, Math.min(durationSec, elapsedInItem));
  const remainingSec = Math.max(0, durationSec - elapsedSec);
  const progressPercent = Math.min(100, Math.max(0, (elapsedSec / durationSec) * 100));
  const nextItem = pool[(currentIndex + 1) % pool.length];
  const nextStartTime = now + remainingSec;

  return {
    channel,
    currentItem,
    initialTimecode: elapsedSec,
    elapsedSec,
    remainingSec,
    durationSec,
    progressPercent,
    nextItem,
    nextStartTime,
    formattedElapsed: formatTimecode(elapsedSec),
    formattedDuration: formatTimecode(durationSec),
    formattedTimeRemaining: formatTimeRemaining(remainingSec, language),
    formattedNextTime: formatClockTime(nextStartTime),
    slotIndex: currentIndex,
    dayOfWeek
  };
}

// Получение непрерывного расписания на 10 передач (текущая + 9 последующих) с реальным временем старта
export function getChannelUpcomingSchedule(
  channel: TvChannel, 
  currentTimestampSec?: number
): Array<{ item: TvPlaylistItem; startTimeSec: number; formattedStartTime: string; isCurrent: boolean; slotNum: number; isTomorrow: boolean }> {
  const now = currentTimestampSec ?? Math.floor(Date.now() / 1000);
  const state = getChannelScheduleState(channel, undefined, now);
  const pool = getChannelPool(channel);
  if (pool.length === 0) return [];

  const d = new Date(now * 1000);
  const currentDay = d.getDate();

  const result: Array<{ item: TvPlaylistItem; startTimeSec: number; formattedStartTime: string; isCurrent: boolean; slotNum: number; isTomorrow: boolean }> = [];

  // 1. Текущий активный эфир
  const currentStartTime = now - state.elapsedSec;
  result.push({
    item: state.currentItem,
    startTimeSec: currentStartTime,
    formattedStartTime: formatClockTime(currentStartTime),
    isCurrent: true,
    slotNum: 1,
    isTomorrow: false
  });

  // Последовательно следующие 9 передач из пула без повторов (для фильмов и сериалов)
  const baseIdx = state.slotIndex >= 0 && state.slotIndex < pool.length ? state.slotIndex : 0;
  let cumulativeTime = now + state.remainingSec;
  const defaultDuration = channel.category === 'series' ? 2700 : 7200;

  for (let step = 1; step < 10; step++) {
    const nextIdx = (baseIdx + step) % pool.length;
    const nextItem = pool[nextIdx];
    const isTomorrow = new Date(cumulativeTime * 1000).getDate() !== currentDay;
    result.push({
      item: nextItem,
      startTimeSec: cumulativeTime,
      formattedStartTime: formatClockTime(cumulativeTime),
      isCurrent: false,
      slotNum: step + 1,
      isTomorrow
    });
    cumulativeTime += (nextItem.durationSec || defaultDuration);
  }

  return result;
}

// Совместимость с экспортом getChannelDayItems: возвращает 10 тайтлов на указанный день недели
export function getChannelDayItems(channel: TvChannel, dayOfWeek = 0, currentTimestampSec?: number): TvPlaylistItem[] {
  const now = currentTimestampSec ?? Math.floor(Date.now() / 1000);
  const weekNumber = Math.max(0, Math.floor((now - EPOCH_ANCHOR_SEC) / 604800));
  return getDayItemsForChannel(channel, dayOfWeek, weekNumber);
}

// Получение локализованного названия передачи / фильма
export function getItemTitle(item?: TvPlaylistItem | null, lang?: string): string {
  if (!item) return '';
  if (!lang || lang.startsWith('ru')) {
    return item.title;
  }
  return item.origin_title || item.title;
}

// Получение локализованного названия канала
export function getChannelName(channel?: TvChannel | null, lang?: string): string {
  if (!channel) return '';
  if (!lang || lang.startsWith('ru')) {
    return channel.nameRu;
  }
  return channel.nameEn || channel.nameRu;
}

// Получение локализованного жанра канала
export function getChannelGenre(channel?: TvChannel | null, lang?: string): string {
  if (!channel) return '';
  if (!lang || lang.startsWith('ru')) {
    return channel.genreNameRu;
  }
  return channel.genreNameEn || channel.genreNameRu;
}
