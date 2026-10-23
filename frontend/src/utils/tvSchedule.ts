// Движок детерминированной сетки вещания MediaBox TV (Pseudo-Linear TV)
// Вычисляет текущее состояние эфира и расписание от фиксированного Unix-таймстампа
// Сложность: O(1) для фильмов с фиксированными слотами, O(log N) для марафонов сериалов

export interface TvPlaylistItem {
  id: number; // TMDB ID для подгрузки постеров и потоков через Liftw
  title: string;
  origin_title?: string;
  year: string;
  type: 'movie' | 'tv';
  durationSec: number; // Точный хронометраж в секундах
  posterPath: string; // Относительный путь TMDB (/path.jpg)
  // Для сериалов:
  season?: string;
  episode?: string;
  episodeTitle?: string;
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
  playlist: TvPlaylistItem[];
}

export interface ChannelScheduleState {
  channel: TvChannel;
  currentItem: TvPlaylistItem;
  initialTimecode: number; // Точный сдвиг в секундах от старта тайтла
  elapsedSec: number;
  remainingSec: number;
  durationSec: number;
  progressPercent: number; // 0..100
  nextItem: TvPlaylistItem;
  nextStartTime: number; // Unix timestamp старта следующего тайтла в секундах
  formattedElapsed: string; // ЧЧ:ММ:СС или ММ:СС
  formattedDuration: string;
  formattedTimeRemaining: string; // "осталось 42 мин"
  formattedNextTime: string; // "14:35"
}

// Фиксированная точка эпохи для детерминированного цикла сетки (1 января 2024 00:00:00 UTC)
const BASE_EPOCH_SEC = 1704067200;

// Каталог каналов: проверенные топовые тайтлы (высокий рейтинг и наличие у донора)
export const TV_CHANNELS: TvChannel[] = [
  // --- КАНАЛЫ ФИЛЬМОВ ПО ЖАНРАМ ---
  {
    id: 'ch-action',
    category: 'movies',
    genreNameRu: 'Боевик',
    genreNameEn: 'Action',
    nameRu: 'Боевик ТВ',
    nameEn: 'Action TV',
    icon: '💥',
    color: 'from-orange-600 to-red-600',
    playlist: [
      {
        id: 603692,
        title: 'Джон Уик 4',
        origin_title: 'John Wick: Chapter 4',
        year: '2023',
        type: 'movie',
        durationSec: 10140, // 169 мин
        posterPath: '/vZloFAK7NKnMGKEslUsZloYfO30.jpg'
      },
      {
        id: 76341,
        title: 'Безумный Макс: Дорога ярости',
        origin_title: 'Mad Max: Fury Road',
        year: '2015',
        type: 'movie',
        durationSec: 7200, // 120 мин
        posterPath: '/8tZYtuWezp8JbcsvHYO0O46tFbo.jpg'
      },
      {
        id: 155,
        title: 'Тёмный рыцарь',
        origin_title: 'The Dark Knight',
        year: '2008',
        type: 'movie',
        durationSec: 9120, // 152 мин
        posterPath: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg'
      },
      {
        id: 98,
        title: 'Гладиатор',
        origin_title: 'Gladiator',
        year: '2000',
        type: 'movie',
        durationSec: 9300, // 155 мин
        posterPath: '/ehGpN04zAJ3bL1n3U0bJ5Z3M0Q8.jpg'
      },
      {
        id: 105,
        title: 'Леон',
        origin_title: 'Léon: The Professional',
        year: '1994',
        type: 'movie',
        durationSec: 6600, // 110 мин
        posterPath: '/wA2W0tP0x4v5hM9m7K4vT6X6Y2.jpg'
      },
      {
        id: 562,
        title: 'Крепкий орешек',
        origin_title: 'Die Hard',
        year: '1988',
        type: 'movie',
        durationSec: 7920, // 132 мин
        posterPath: '/yFihBXQGQstsvAaq5ybp551Y7a1.jpg'
      }
    ]
  },
  {
    id: 'ch-comedy',
    category: 'movies',
    genreNameRu: 'Комедия',
    genreNameEn: 'Comedy',
    nameRu: 'Комедия ТВ',
    nameEn: 'Comedy TV',
    icon: '😂',
    color: 'from-amber-500 to-yellow-500',
    playlist: [
      {
        id: 77338,
        title: '1+1',
        origin_title: 'The Intouchables',
        year: '2011',
        type: 'movie',
        durationSec: 6720, // 112 мин
        posterPath: '/3weAM0eGss4c59aL1n2qX8d0tF2.jpg'
      },
      {
        id: 18785,
        title: 'Мальчишник в Вегасе',
        origin_title: 'The Hangover',
        year: '2009',
        type: 'movie',
        durationSec: 6000, // 100 мин
        posterPath: '/uluhlXubGu1VxU63X9Cd8n8ggag.jpg'
      },
      {
        id: 522627,
        title: 'Джентльмены',
        origin_title: 'The Gentlemen',
        year: '2019',
        type: 'movie',
        durationSec: 6780, // 113 мин
        posterPath: '/jtrhTYB7ik9sgDC2M5r0ig1qiCw.jpg'
      },
      {
        id: 310,
        title: 'Брюс Всемогущий',
        origin_title: 'Bruce Almighty',
        year: '2003',
        type: 'movie',
        durationSec: 6060, // 101 мин
        posterPath: '/b4UskPz84h0Jz3r2n3y8f0s8s2.jpg'
      },
      {
        id: 138832,
        title: 'Мы — Миллеры',
        origin_title: "We're the Millers",
        year: '2013',
        type: 'movie',
        durationSec: 6600, // 110 мин
        posterPath: '/8Z0Zt5M3w5m7u3d8k4x1y0s2d2.jpg'
      },
      {
        id: 490132,
        title: 'Зелёная книга',
        origin_title: 'Green Book',
        year: '2018',
        type: 'movie',
        durationSec: 7800, // 130 мин
        posterPath: '/7BsvLvr4z7acf6FyoioiiQ99w5n.jpg'
      }
    ]
  },
  {
    id: 'ch-scifi',
    category: 'movies',
    genreNameRu: 'Фантастика',
    genreNameEn: 'Sci-Fi',
    nameRu: 'Фантастика ТВ',
    nameEn: 'Sci-Fi TV',
    icon: '🚀',
    color: 'from-blue-600 to-indigo-600',
    playlist: [
      {
        id: 157336,
        title: 'Интерстеллар',
        origin_title: 'Interstellar',
        year: '2014',
        type: 'movie',
        durationSec: 10140, // 169 мин
        posterPath: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg'
      },
      {
        id: 27205,
        title: 'Начало',
        origin_title: 'Inception',
        year: '2010',
        type: 'movie',
        durationSec: 8880, // 148 мин
        posterPath: '/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg'
      },
      {
        id: 603,
        title: 'Матрица',
        origin_title: 'The Matrix',
        year: '1999',
        type: 'movie',
        durationSec: 8160, // 136 мин
        posterPath: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg'
      },
      {
        id: 335984,
        title: 'Бегущий по лезвию 2049',
        origin_title: 'Blade Runner 2049',
        year: '2017',
        type: 'movie',
        durationSec: 9840, // 164 мин
        posterPath: '/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg'
      },
      {
        id: 19995,
        title: 'Аватар',
        origin_title: 'Avatar',
        year: '2009',
        type: 'movie',
        durationSec: 9720, // 162 мин
        posterPath: '/kyeqWdyUXW608qlYkRqosgbbJyK.jpg'
      },
      {
        id: 18,
        title: 'Пятый элемент',
        origin_title: 'The Fifth Element',
        year: '1997',
        type: 'movie',
        durationSec: 7560, // 126 мин
        posterPath: '/fPtlR30R07q9r1t1s1v2u4w5x6.jpg'
      }
    ]
  },
  {
    id: 'ch-thriller',
    category: 'movies',
    genreNameRu: 'Триллер & Детектив',
    genreNameEn: 'Thriller',
    nameRu: 'Триллер ТВ',
    nameEn: 'Thriller TV',
    icon: '🕵️',
    color: 'from-purple-700 to-slate-900',
    playlist: [
      {
        id: 11324,
        title: 'Остров проклятых',
        origin_title: 'Shutter Island',
        year: '2010',
        type: 'movie',
        durationSec: 8280, // 138 мин
        posterPath: '/kve20wgB2ZqqUUrV2VGmlhQAO22.jpg'
      },
      {
        id: 807,
        title: 'Семь',
        origin_title: 'Se7en',
        year: '1995',
        type: 'movie',
        durationSec: 7620, // 127 мин
        posterPath: '/6yoghtyTpznpBik8EngEmJskVUO.jpg'
      },
      {
        id: 550,
        title: 'Бойцовский клуб',
        origin_title: 'Fight Club',
        year: '1999',
        type: 'movie',
        durationSec: 8340, // 139 мин
        posterPath: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg'
      },
      {
        id: 1124,
        title: 'Престиж',
        origin_title: 'The Prestige',
        year: '2006',
        type: 'movie',
        durationSec: 7800, // 130 мин
        posterPath: '/tRNlZbgNCNOpLpbPEz5L8G8A0JN.jpg'
      },
      {
        id: 210577,
        title: 'Исчезнувшая',
        origin_title: 'Gone Girl',
        year: '2014',
        type: 'movie',
        durationSec: 8940, // 149 мин
        posterPath: '/qymaJhucquUwjpKV8nAnVTWMhwz.jpg'
      },
      {
        id: 546554,
        title: 'Достать ножи',
        origin_title: 'Knives Out',
        year: '2019',
        type: 'movie',
        durationSec: 7800, // 130 мин
        posterPath: '/pThyQovXQrw2m0s9x8s9x8s9x8.jpg'
      }
    ]
  },
  {
    id: 'ch-horror',
    category: 'movies',
    genreNameRu: 'Ужасы',
    genreNameEn: 'Horror',
    nameRu: 'Ужасы ТВ',
    nameEn: 'Horror TV',
    icon: '👻',
    color: 'from-red-900 to-black',
    playlist: [
      {
        id: 138843,
        title: 'Заклятие',
        origin_title: 'The Conjuring',
        year: '2013',
        type: 'movie',
        durationSec: 6720, // 112 мин
        posterPath: '/wVYREutTvI2tmxr6ujrHT704wGF.jpg'
      },
      {
        id: 49018,
        title: 'Астрал',
        origin_title: 'Insidious',
        year: '2010',
        type: 'movie',
        durationSec: 6180, // 103 мин
        posterPath: '/n0TfE9eC603eU6Y6XfF6V6g1.jpg'
      },
      {
        id: 346364,
        title: 'Оно',
        origin_title: 'It',
        year: '2017',
        type: 'movie',
        durationSec: 8100, // 135 мин
        posterPath: '/9E2y5Q7WlCVNEhP5GiVTjhEhx1o.jpg'
      },
      {
        id: 694,
        title: 'Сияние',
        origin_title: 'The Shining',
        year: '1980',
        type: 'movie',
        durationSec: 8760, // 146 мин
        posterPath: '/b33nnKl1vEZe4TQG2e3y3T2e3.jpg'
      },
      {
        id: 447332,
        title: 'Тихое место',
        origin_title: 'A Quiet Place',
        year: '2018',
        type: 'movie',
        durationSec: 5400, // 90 мин
        posterPath: '/nAU74GmpUk7t5iklEp3bufwDq4n.jpg'
      }
    ]
  },
  {
    id: 'ch-animation',
    category: 'movies',
    genreNameRu: 'Мультфильмы',
    genreNameEn: 'Animation',
    nameRu: 'Мульт ТВ',
    nameEn: 'Cartoon TV',
    icon: '🦁',
    color: 'from-emerald-500 to-teal-600',
    playlist: [
      {
        id: 354912,
        title: 'Тайна Коко',
        origin_title: 'Coco',
        year: '2017',
        type: 'movie',
        durationSec: 6300, // 105 мин
        posterPath: '/gGEsBPAijhVUFoiNpgZXqRVWJt2.jpg'
      },
      {
        id: 809,
        title: 'Шрек 2',
        origin_title: 'Shrek 2',
        year: '2004',
        type: 'movie',
        durationSec: 5580, // 93 мин
        posterPath: '/2yYP0PQjG8zVqneEd2n0rTr0r.jpg'
      },
      {
        id: 14160,
        title: 'Вверх',
        origin_title: 'Up',
        year: '2009',
        type: 'movie',
        durationSec: 5760, // 96 мин
        posterPath: '/vpbaStTMt8qqGBE2VgEEIRLF9WN.jpg'
      },
      {
        id: 2062,
        title: 'Рататуй',
        origin_title: 'Ratatouille',
        year: '2007',
        type: 'movie',
        durationSec: 6660, // 111 мин
        posterPath: '/npHNjld2VT0v6HGwSpW9191d8s.jpg'
      },
      {
        id: 324857,
        title: 'Человек-паук: Через вселенные',
        origin_title: 'Spider-Man: Into the Spider-Verse',
        year: '2018',
        type: 'movie',
        durationSec: 7020, // 117 мин
        posterPath: '/iiZZdoQBEYBv6id8su7ImL0oCbD.jpg'
      }
    ]
  },

  // --- КАНАЛЫ СЕРИАЛОВ (ЭПИЗОДЫ СТРОГО ПО ПОРЯДКУ) ---
  {
    id: 'ch-series-sitcom',
    category: 'series',
    genreNameRu: 'Ситкомы & Комедии',
    genreNameEn: 'Sitcom Series',
    nameRu: 'Ситком ТВ: Друзья',
    nameEn: 'Sitcom TV: Friends',
    icon: '☕',
    color: 'from-amber-600 to-orange-500',
    playlist: [
      // Марафон сериала «Друзья» строго по порядку серий: S01E01..S01E10
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '1',
        episodeTitle: 'Пилот (Где Моника берет соседку)',
        durationSec: 1320, // 22 мин
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      },
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '2',
        episodeTitle: 'Эпизод с сонограммой в конце',
        durationSec: 1320,
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      },
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '3',
        episodeTitle: 'Эпизод с большим пальцем',
        durationSec: 1320,
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      },
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '4',
        episodeTitle: 'Эпизод с Джорджем Стефанопулосом',
        durationSec: 1320,
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      },
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '5',
        episodeTitle: 'Эпизод со стиральным порошком',
        durationSec: 1320,
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      },
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '6',
        episodeTitle: 'Эпизод с задом Аль Пачино',
        durationSec: 1320,
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      },
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '7',
        episodeTitle: 'Эпизод, в котором гаснет свет',
        durationSec: 1320,
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      },
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '8',
        episodeTitle: 'Эпизод, где Нана умирает дважды',
        durationSec: 1320,
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      },
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '9',
        episodeTitle: 'Эпизод, где Унтердок улетает',
        durationSec: 1320,
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      },
      {
        id: 1668,
        title: 'Друзья',
        origin_title: 'Friends',
        year: '1994',
        type: 'tv',
        season: '1',
        episode: '10',
        episodeTitle: 'Эпизод с обезьяной',
        durationSec: 1320,
        posterPath: '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg'
      }
    ]
  },
  {
    id: 'ch-series-crime',
    category: 'series',
    genreNameRu: 'Криминал & Детективы',
    genreNameEn: 'Crime Series',
    nameRu: 'Криминал ТВ: Во все тяжкие',
    nameEn: 'Crime TV: Breaking Bad',
    icon: '🧪',
    color: 'from-emerald-700 to-lime-600',
    playlist: [
      // Марафон сериала «Во все тяжкие» строго по порядку серий: S01E01..S01E07
      {
        id: 1396,
        title: 'Во все тяжкие',
        origin_title: 'Breaking Bad',
        year: '2008',
        type: 'tv',
        season: '1',
        episode: '1',
        episodeTitle: 'Пилотная серия',
        durationSec: 3480, // 58 мин
        posterPath: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg'
      },
      {
        id: 1396,
        title: 'Во все тяжкие',
        origin_title: 'Breaking Bad',
        year: '2008',
        type: 'tv',
        season: '1',
        episode: '2',
        episodeTitle: 'Кот в мешке...',
        durationSec: 2880, // 48 мин
        posterPath: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg'
      },
      {
        id: 1396,
        title: 'Во все тяжкие',
        origin_title: 'Breaking Bad',
        year: '2008',
        type: 'tv',
        season: '1',
        episode: '3',
        episodeTitle: '...и мешок в реке',
        durationSec: 2880,
        posterPath: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg'
      },
      {
        id: 1396,
        title: 'Во все тяжкие',
        origin_title: 'Breaking Bad',
        year: '2008',
        type: 'tv',
        season: '1',
        episode: '4',
        episodeTitle: 'Раковый больной',
        durationSec: 2880,
        posterPath: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg'
      },
      {
        id: 1396,
        title: 'Во все тяжкие',
        origin_title: 'Breaking Bad',
        year: '2008',
        type: 'tv',
        season: '1',
        episode: '5',
        episodeTitle: 'Серое вещество',
        durationSec: 2880,
        posterPath: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg'
      },
      {
        id: 1396,
        title: 'Во все тяжкие',
        origin_title: 'Breaking Bad',
        year: '2008',
        type: 'tv',
        season: '1',
        episode: '6',
        episodeTitle: 'Пригоршня ничего',
        durationSec: 2880,
        posterPath: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg'
      },
      {
        id: 1396,
        title: 'Во все тяжкие',
        origin_title: 'Breaking Bad',
        year: '2008',
        type: 'tv',
        season: '1',
        episode: '7',
        episodeTitle: 'Особо опасный бизнес',
        durationSec: 2880,
        posterPath: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg'
      }
    ]
  },
  {
    id: 'ch-series-scifi',
    category: 'series',
    genreNameRu: 'Sci-Fi & Мистика',
    genreNameEn: 'Sci-Fi Series',
    nameRu: 'Sci-Fi ТВ: Очень странные дела',
    nameEn: 'Sci-Fi TV: Stranger Things',
    icon: '🚲',
    color: 'from-rose-800 to-indigo-950',
    playlist: [
      // Марафон «Очень странные дела» строго по порядку серий: S01E01..S01E08
      {
        id: 66732,
        title: 'Очень странные дела',
        origin_title: 'Stranger Things',
        year: '2016',
        type: 'tv',
        season: '1',
        episode: '1',
        episodeTitle: 'Исчезновение Уилла Байерса',
        durationSec: 2880, // 48 мин
        posterPath: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg'
      },
      {
        id: 66732,
        title: 'Очень странные дела',
        origin_title: 'Stranger Things',
        year: '2016',
        type: 'tv',
        season: '1',
        episode: '2',
        episodeTitle: 'Чудачка на Кленовой улице',
        durationSec: 3300, // 55 мин
        posterPath: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg'
      },
      {
        id: 66732,
        title: 'Очень странные дела',
        origin_title: 'Stranger Things',
        year: '2016',
        type: 'tv',
        season: '1',
        episode: '3',
        episodeTitle: 'Холли, весёлая',
        durationSec: 3060, // 51 мин
        posterPath: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg'
      },
      {
        id: 66732,
        title: 'Очень странные дела',
        origin_title: 'Stranger Things',
        year: '2016',
        type: 'tv',
        season: '1',
        episode: '4',
        episodeTitle: 'Тело',
        durationSec: 3000, // 50 мин
        posterPath: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg'
      },
      {
        id: 66732,
        title: 'Очень странные дела',
        origin_title: 'Stranger Things',
        year: '2016',
        type: 'tv',
        season: '1',
        episode: '5',
        episodeTitle: 'Блоха и акробат',
        durationSec: 3180, // 53 мин
        posterPath: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg'
      },
      {
        id: 66732,
        title: 'Очень странные дела',
        origin_title: 'Stranger Things',
        year: '2016',
        type: 'tv',
        season: '1',
        episode: '6',
        episodeTitle: 'Монстр',
        durationSec: 2760, // 46 мин
        posterPath: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg'
      },
      {
        id: 66732,
        title: 'Очень странные дела',
        origin_title: 'Stranger Things',
        year: '2016',
        type: 'tv',
        season: '1',
        episode: '7',
        episodeTitle: 'Ванна',
        durationSec: 2520, // 42 мин
        posterPath: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg'
      },
      {
        id: 66732,
        title: 'Очень странные дела',
        origin_title: 'Stranger Things',
        year: '2016',
        type: 'tv',
        season: '1',
        episode: '8',
        episodeTitle: 'Вверх дном',
        durationSec: 3300, // 55 мин
        posterPath: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg'
      }
    ]
  },
  {
    id: 'ch-series-drama',
    category: 'series',
    genreNameRu: 'Драмы & Криминал',
    genreNameEn: 'Drama Series',
    nameRu: 'Драма ТВ: Острые козырьки',
    nameEn: 'Drama TV: Peaky Blinders',
    icon: '🥃',
    color: 'from-slate-800 to-amber-950',
    playlist: [
      // Марафон «Острые козырьки» строго по порядку серий: S01E01..S01E06
      {
        id: 60574,
        title: 'Острые козырьки',
        origin_title: 'Peaky Blinders',
        year: '2013',
        type: 'tv',
        season: '1',
        episode: '1',
        episodeTitle: 'Сезон 1, Эпизод 1',
        durationSec: 3420, // 57 мин
        posterPath: '/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg'
      },
      {
        id: 60574,
        title: 'Острые козырьки',
        origin_title: 'Peaky Blinders',
        year: '2013',
        type: 'tv',
        season: '1',
        episode: '2',
        episodeTitle: 'Сезон 1, Эпизод 2',
        durationSec: 3420,
        posterPath: '/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg'
      },
      {
        id: 60574,
        title: 'Острые козырьки',
        origin_title: 'Peaky Blinders',
        year: '2013',
        type: 'tv',
        season: '1',
        episode: '3',
        episodeTitle: 'Сезон 1, Эпизод 3',
        durationSec: 3300,
        posterPath: '/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg'
      },
      {
        id: 60574,
        title: 'Острые козырьки',
        origin_title: 'Peaky Blinders',
        year: '2013',
        type: 'tv',
        season: '1',
        episode: '4',
        episodeTitle: 'Сезон 1, Эпизод 4',
        durationSec: 3480,
        posterPath: '/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg'
      },
      {
        id: 60574,
        title: 'Острые козырьки',
        origin_title: 'Peaky Blinders',
        year: '2013',
        type: 'tv',
        season: '1',
        episode: '5',
        episodeTitle: 'Сезон 1, Эпизод 5',
        durationSec: 3300,
        posterPath: '/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg'
      },
      {
        id: 60574,
        title: 'Острые козырьки',
        origin_title: 'Peaky Blinders',
        year: '2013',
        type: 'tv',
        season: '1',
        episode: '6',
        episodeTitle: 'Сезон 1, Эпизод 6',
        durationSec: 3300,
        posterPath: '/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg'
      }
    ]
  }
];

// Форматирование секунд в строку ММ:СС или ЧЧ:ММ:СС
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

// Форматирование Unix-метки времени в локальное время ЧЧ:ММ
export function formatClockTime(timestampSec: number): string {
  const d = new Date(timestampSec * 1000);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Расчёт текущего состояния прямого эфира канала
export function getChannelScheduleState(
  channel: TvChannel, 
  currentTimestampSec?: number
): ChannelScheduleState {
  const now = currentTimestampSec ?? Math.floor(Date.now() / 1000);
  const playlist = channel.playlist;

  // Суммарная продолжительность всего круга вещания канала
  const totalCycleDuration = playlist.reduce((acc, item) => acc + item.durationSec, 0);
  if (totalCycleDuration <= 0) {
    throw new Error(`Канал ${channel.id} имеет пустой или некорректный плейлист`);
  }

  // Смещение внутри бесконечного цикла от базовой эпохи
  let cycleOffset = (now - BASE_EPOCH_SEC) % totalCycleDuration;
  if (cycleOffset < 0) cycleOffset += totalCycleDuration;

  let accumulated = 0;
  let activeIndex = 0;
  let elapsedInItem = 0;

  for (let i = 0; i < playlist.length; i++) {
    const item = playlist[i];
    if (cycleOffset >= accumulated && cycleOffset < accumulated + item.durationSec) {
      activeIndex = i;
      elapsedInItem = cycleOffset - accumulated;
      break;
    }
    accumulated += item.durationSec;
  }

  const currentItem = playlist[activeIndex];
  const remainingSec = Math.max(0, currentItem.durationSec - elapsedInItem);
  const progressPercent = Math.min(100, Math.max(0, (elapsedInItem / currentItem.durationSec) * 100));

  const nextIndex = (activeIndex + 1) % playlist.length;
  const nextItem = playlist[nextIndex];
  const nextStartTime = now + remainingSec;

  const remainingMinutes = Math.ceil(remainingSec / 60);
  const formattedTimeRemaining = remainingMinutes >= 60 
    ? `осталось ${Math.floor(remainingMinutes / 60)} ч ${remainingMinutes % 60} мин` 
    : `осталось ${remainingMinutes} мин`;

  return {
    channel,
    currentItem,
    initialTimecode: elapsedInItem,
    elapsedSec: elapsedInItem,
    remainingSec,
    durationSec: currentItem.durationSec,
    progressPercent,
    nextItem,
    nextStartTime,
    formattedElapsed: formatTimecode(elapsedInItem),
    formattedDuration: formatTimecode(currentItem.durationSec),
    formattedTimeRemaining,
    formattedNextTime: formatClockTime(nextStartTime)
  };
}

// Получение списка ближайших передач канала (программа передач на 12–24 часа)
export function getChannelUpcomingSchedule(
  channel: TvChannel, 
  count = 6, 
  currentTimestampSec?: number
): Array<{ item: TvPlaylistItem; startTimeSec: number; formattedStartTime: string }> {
  const currentState = getChannelScheduleState(channel, currentTimestampSec);
  const result: Array<{ item: TvPlaylistItem; startTimeSec: number; formattedStartTime: string }> = [];

  // Первым элементом идёт текущий эфир
  result.push({
    item: currentState.currentItem,
    startTimeSec: (currentTimestampSec ?? Math.floor(Date.now() / 1000)) - currentState.elapsedSec,
    formattedStartTime: formatClockTime((currentTimestampSec ?? Math.floor(Date.now() / 1000)) - currentState.elapsedSec)
  });

  let runningStartTime = currentState.nextStartTime;
  const playlist = channel.playlist;
  const currentIndex = playlist.findIndex(p => p === currentState.currentItem);

  for (let i = 1; i < count; i++) {
    const nextIdx = (currentIndex + i) % playlist.length;
    const item = playlist[nextIdx];
    result.push({
      item,
      startTimeSec: runningStartTime,
      formattedStartTime: formatClockTime(runningStartTime)
    });
    runningStartTime += item.durationSec;
  }

  return result;
}
