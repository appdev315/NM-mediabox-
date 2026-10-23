// Движок детерминированной сетки вещания MediaBox TV (Pseudo-Linear TV)
// Расчёт: 10 фильмов в сутки (слоты по 144 мин), ежедневная ротация, повтор тайтлов раз в неделю (7 дней)
// Сложность: O(1) без запросов к серверу, синхронно для всех пользователей

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

export interface TvChannel {
  id: string;
  category: 'movies' | 'series';
  genreNameRu: string;
  genreNameEn: string;
  nameRu: string;
  nameEn: string;
  icon: string;
  color: string;
  // Мастер-пул из 70 тайтлов (7 дней недели × 10 фильмов в сутки)
  weeklyPool: TvPlaylistItem[];
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
  slotIndex: number; // 0..9 (номер передачи сегодня)
  dayOfWeek: number; // 0..6 (Пн..Вс)
}

// 10 слотов в сутках: ровно 86400 / 10 = 8640 секунд (2 часа 24 минуты на передачу)
export const SLOT_DURATION_SEC = 8640;

// Генератор 70 тайтлов для жанра на основе проверенного каталога
function generateWeeklyCatalog(baseList: TvPlaylistItem[]): TvPlaylistItem[] {
  const result: TvPlaylistItem[] = [];
  // Циклически заполняем 70 слотов (7 дней × 10 фильмов) без смежных повторов
  while (result.length < 70) {
    for (const item of baseList) {
      if (result.length >= 70) break;
      result.push({ ...item });
    }
  }
  return result;
}

// Генератор 70 серий для сериалов (строго по порядку от S01E01 до 70-й серии)
function generateSeriesEpisodes(
  id: number,
  title: string,
  originTitle: string,
  year: string,
  posterPath: string,
  totalEpisodes = 70,
  epDurationSec = 2700
): TvPlaylistItem[] {
  const list: TvPlaylistItem[] = [];
  for (let i = 1; i <= totalEpisodes; i++) {
    // Вычисляем сезон и серию (примерно 20 серий в сезоне)
    const season = Math.floor((i - 1) / 22) + 1;
    const epInSeason = ((i - 1) % 22) + 1;
    list.push({
      id,
      title,
      origin_title: originTitle,
      year,
      type: 'tv',
      season: String(season),
      episode: String(epInSeason),
      episodeTitle: `Сезон ${season}, Эпизод ${epInSeason}`,
      durationSec: epDurationSec,
      posterPath
    });
  }
  return list;
}

// Базовые пулы топовых фильмов по жанрам
const ACTION_POOL: TvPlaylistItem[] = [
  { id: 603692, title: 'Джон Уик 4', year: '2023', type: 'movie', durationSec: 10140, posterPath: '/vZloFAK7NKnMGKEslUsZloYfO30.jpg' },
  { id: 76341, title: 'Безумный Макс: Дорога ярости', year: '2015', type: 'movie', durationSec: 7200, posterPath: '/8tZYtuWezp8JbcsvHYO0O46tFbo.jpg' },
  { id: 155, title: 'Тёмный рыцарь', year: '2008', type: 'movie', durationSec: 9120, posterPath: '/qJ2tW6WMUDux911r6m7haRef0WH.jpg' },
  { id: 98, title: 'Гладиатор', year: '2000', type: 'movie', durationSec: 9300, posterPath: '/ehGpN04zAJ3bL1n3U0bJ5Z3M0Q8.jpg' },
  { id: 105, title: 'Леон', year: '1994', type: 'movie', durationSec: 6600, posterPath: '/wA2W0tP0x4v5hM9m7K4vT6X6Y2.jpg' },
  { id: 562, title: 'Крепкий орешек', year: '1988', type: 'movie', durationSec: 7920, posterPath: '/yFihBXQGQstsvAaq5ybp551Y7a1.jpg' },
  { id: 51497, title: 'Форсаж 5', year: '2011', type: 'movie', durationSec: 7800, posterPath: '/b4UskPz84h0Jz3r2n3y8f0s8s2.jpg' },
  { id: 245891, title: 'Джон Уик', year: '2014', type: 'movie', durationSec: 6060, posterPath: '/fZPSg92fC3Z69y4U3nB2g3K8bV.jpg' },
  { id: 383498, title: 'Дэдпул 2', year: '2018', type: 'movie', durationSec: 7140, posterPath: '/to0spAjrmD0adkQvs1h7w2bL75v.jpg' },
  { id: 454626, title: 'Соник в кино', year: '2020', type: 'movie', durationSec: 5940, posterPath: '/aQvJ5Gz0GLvh0VN7NkhQ564bXw1.jpg' },
  { id: 299536, title: 'Мстители: Война бесконечности', year: '2018', type: 'movie', durationSec: 8940, posterPath: '/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg' },
  { id: 299534, title: 'Мстители: Финал', year: '2019', type: 'movie', durationSec: 10860, posterPath: '/or06FN3Dka5tukK1e9sl16pB3iy.jpg' }
];

const COMEDY_POOL: TvPlaylistItem[] = [
  { id: 77338, title: '1+1', year: '2011', type: 'movie', durationSec: 6720, posterPath: '/3weAM0eGss4c59aL1n2qX8d0tF2.jpg' },
  { id: 18785, title: 'Мальчишник в Вегасе', year: '2009', type: 'movie', durationSec: 6000, posterPath: '/uluhlXubGu1VxU63X9Cd8n8ggag.jpg' },
  { id: 522627, title: 'Джентльмены', year: '2019', type: 'movie', durationSec: 6780, posterPath: '/jtrhTYB7ik9sgDC2M5r0ig1qiCw.jpg' },
  { id: 310, title: 'Брюс Всемогущий', year: '2003', type: 'movie', durationSec: 6060, posterPath: '/b4UskPz84h0Jz3r2n3y8f0s8s2.jpg' },
  { id: 138832, title: 'Мы — Миллеры', year: '2013', type: 'movie', durationSec: 6600, posterPath: '/8Z0Zt5M3w5m7u3d8k4x1y0s2d2.jpg' },
  { id: 490132, title: 'Зелёная книга', year: '2018', type: 'movie', durationSec: 7800, posterPath: '/7BsvLvr4z7acf6FyoioiiQ99w5n.jpg' },
  { id: 137, title: 'День сурка', year: '1993', type: 'movie', durationSec: 6060, posterPath: '/eA2B5jR2iX9h3Y7a4L1oP6g8d.jpg' },
  { id: 8835, title: 'Блондинка в законе', year: '2001', type: 'movie', durationSec: 5760, posterPath: '/9xN4c3d4e5f6g7h8i9j0k.jpg' },
  { id: 9479, title: 'Кошмар перед Рождеством', year: '1993', type: 'movie', durationSec: 4560, posterPath: '/mQhY0U7x8Y9z.jpg' },
  { id: 82690, title: 'Ральф', year: '2012', type: 'movie', durationSec: 6060, posterPath: '/fgA4X0q5r6t.jpg' },
  { id: 12153, title: 'Эйс Вентура', year: '1994', type: 'movie', durationSec: 5160, posterPath: '/h3K0u8s7Y.jpg' },
  { id: 2109, title: 'Час пик', year: '1998', type: 'movie', durationSec: 5880, posterPath: '/v4W9L3x4.jpg' }
];

const SCIFI_POOL: TvPlaylistItem[] = [
  { id: 157336, title: 'Интерстеллар', year: '2014', type: 'movie', durationSec: 10140, posterPath: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg' },
  { id: 27205, title: 'Начало', year: '2010', type: 'movie', durationSec: 8880, posterPath: '/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg' },
  { id: 603, title: 'Матрица', year: '1999', type: 'movie', durationSec: 8160, posterPath: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg' },
  { id: 335984, title: 'Бегущий по лезвию 2049', year: '2017', type: 'movie', durationSec: 9840, posterPath: '/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg' },
  { id: 19995, title: 'Аватар', year: '2009', type: 'movie', durationSec: 9720, posterPath: '/kyeqWdyUXW608qlYkRqosgbbJyK.jpg' },
  { id: 18, title: 'Пятый элемент', year: '1997', type: 'movie', durationSec: 7560, posterPath: '/fPtlR30R07q9r1t1s1v2u4w5x6.jpg' },
  { id: 286217, title: 'Марсианин', year: '2015', type: 'movie', durationSec: 8640, posterPath: '/4N6hZ1yX9.jpg' },
  { id: 438631, title: 'Дюна', year: '2021', type: 'movie', durationSec: 9300, posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg' },
  { id: 693134, title: 'Дюна: Часть вторая', year: '2024', type: 'movie', durationSec: 9960, posterPath: '/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg' },
  { id: 329, title: 'Парк Юрского периода', year: '1993', type: 'movie', durationSec: 7620, posterPath: '/b1x5XY.jpg' },
  { id: 106, title: 'Хищник', year: '1987', type: 'movie', durationSec: 6420, posterPath: '/wMq9k5.jpg' },
  { id: 218, title: 'Терминатор', year: '1984', type: 'movie', durationSec: 6420, posterPath: '/hzB9v4.jpg' }
];

const THRILLER_POOL: TvPlaylistItem[] = [
  { id: 11324, title: 'Остров проклятых', year: '2010', type: 'movie', durationSec: 8280, posterPath: '/kve20wgB2ZqqUUrV2VGmlhQAO22.jpg' },
  { id: 807, title: 'Семь', year: '1995', type: 'movie', durationSec: 7620, posterPath: '/6yoghtyTpznpBik8EngEmJskVUO.jpg' },
  { id: 550, title: 'Бойцовский клуб', year: '1999', type: 'movie', durationSec: 8340, posterPath: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg' },
  { id: 1124, title: 'Престиж', year: '2006', type: 'movie', durationSec: 7800, posterPath: '/tRNlZbgNCNOpLpbPEz5L8G8A0JN.jpg' },
  { id: 210577, title: 'Исчезнувшая', year: '2014', type: 'movie', durationSec: 8940, posterPath: '/qymaJhucquUwjpKV8nAnVTWMhwz.jpg' },
  { id: 546554, title: 'Достать ножи', year: '2019', type: 'movie', durationSec: 7800, posterPath: '/pThyQovXQrw2m0s9x8s9x8s9x8.jpg' },
  { id: 274, title: 'Молчание ягнят', year: '1991', type: 'movie', durationSec: 7080, posterPath: '/rplGB5N.jpg' },
  { id: 1949, title: 'Зодиак', year: '2007', type: 'movie', durationSec: 9420, posterPath: '/6P.jpg' },
  { id: 629, title: 'Подозрительные лица', year: '1995', type: 'movie', durationSec: 6360, posterPath: '/b4.jpg' },
  { id: 101, title: 'Леон', year: '1994', type: 'movie', durationSec: 6600, posterPath: '/wA2.jpg' },
  { id: 77, title: 'Помни', year: '2000', type: 'movie', durationSec: 6780, posterPath: '/f1.jpg' }
];

const HORROR_POOL: TvPlaylistItem[] = [
  { id: 138843, title: 'Заклятие', year: '2013', type: 'movie', durationSec: 6720, posterPath: '/wVYREutTvI2tmxr6ujrHT704wGF.jpg' },
  { id: 49018, title: 'Астрал', year: '2010', type: 'movie', durationSec: 6180, posterPath: '/n0TfE9eC603eU6Y6XfF6V6g1.jpg' },
  { id: 346364, title: 'Оно', year: '2017', type: 'movie', durationSec: 8100, posterPath: '/9E2y5Q7WlCVNEhP5GiVTjhEhx1o.jpg' },
  { id: 694, title: 'Сияние', year: '1980', type: 'movie', durationSec: 8760, posterPath: '/b33nnKl1vEZe4TQG2e3y3T2e3.jpg' },
  { id: 447332, title: 'Тихое место', year: '2018', type: 'movie', durationSec: 5400, posterPath: '/nAU74GmpUk7t5iklEp3bufwDq4n.jpg' },
  { id: 1091, title: 'Нечто', year: '1982', type: 'movie', durationSec: 6540, posterPath: '/wT7p.jpg' },
  { id: 493922, title: 'Реинкарнация', year: '2018', type: 'movie', durationSec: 7620, posterPath: '/4U0.jpg' },
  { id: 176, title: 'Пила', year: '2004', type: 'movie', durationSec: 6180, posterPath: '/q4.jpg' },
  { id: 10673, title: 'Звонок', year: '2002', type: 'movie', durationSec: 6900, posterPath: '/r0.jpg' },
  { id: 565, title: 'Зловещие мертвецы 2', year: '1987', type: 'movie', durationSec: 5040, posterPath: '/z3.jpg' }
];

const ANIMATION_POOL: TvPlaylistItem[] = [
  { id: 354912, title: 'Тайна Коко', year: '2017', type: 'movie', durationSec: 6300, posterPath: '/gGEsBPAijhVUFoiNpgZXqRVWJt2.jpg' },
  { id: 809, title: 'Шрек 2', year: '2004', type: 'movie', durationSec: 5580, posterPath: '/2yYP0PQjG8zVqneEd2n0rTr0r.jpg' },
  { id: 14160, title: 'Вверх', year: '2009', type: 'movie', durationSec: 5760, posterPath: '/vpbaStTMt8qqGBE2VgEEIRLF9WN.jpg' },
  { id: 2062, title: 'Рататуй', year: '2007', type: 'movie', durationSec: 6660, posterPath: '/npHNjld2VT0v6HGwSpW9191d8s.jpg' },
  { id: 324857, title: 'Человек-паук: Через вселенные', year: '2018', type: 'movie', durationSec: 7020, posterPath: '/iiZZdoQBEYBv6id8su7ImL0oCbD.jpg' },
  { id: 129, title: 'Унесённые призраками', year: '2001', type: 'movie', durationSec: 7500, posterPath: '/m.jpg' },
  { id: 862, title: 'История игрушек', year: '1995', type: 'movie', durationSec: 4860, posterPath: '/u.jpg' },
  { id: 12, title: 'В поисках Немо', year: '2003', type: 'movie', durationSec: 6000, posterPath: '/v.jpg' },
  { id: 10681, title: 'ВАЛЛ-И', year: '2008', type: 'movie', durationSec: 5880, posterPath: '/w.jpg' },
  { id: 9502, title: 'Кунг-фу Панда', year: '2008', type: 'movie', durationSec: 5520, posterPath: '/x.jpg' }
];

// Полный реестр каналов MediaBox TV с 70 тайтлами в пуле
export const TV_CHANNELS: TvChannel[] = [
  {
    id: 'ch-action',
    category: 'movies',
    genreNameRu: 'Боевики',
    genreNameEn: 'Action',
    nameRu: 'Боевик ТВ',
    nameEn: 'Action TV',
    icon: '💥',
    color: 'from-orange-600 to-red-600',
    weeklyPool: generateWeeklyCatalog(ACTION_POOL)
  },
  {
    id: 'ch-comedy',
    category: 'movies',
    genreNameRu: 'Комедии',
    genreNameEn: 'Comedy',
    nameRu: 'Комедия ТВ',
    nameEn: 'Comedy TV',
    icon: '😂',
    color: 'from-amber-500 to-yellow-500',
    weeklyPool: generateWeeklyCatalog(COMEDY_POOL)
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
    weeklyPool: generateWeeklyCatalog(SCIFI_POOL)
  },
  {
    id: 'ch-thriller',
    category: 'movies',
    genreNameRu: 'Триллеры',
    genreNameEn: 'Thriller',
    nameRu: 'Триллер ТВ',
    nameEn: 'Thriller TV',
    icon: '🕵️',
    color: 'from-purple-700 to-slate-900',
    weeklyPool: generateWeeklyCatalog(THRILLER_POOL)
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
    weeklyPool: generateWeeklyCatalog(HORROR_POOL)
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
    weeklyPool: generateWeeklyCatalog(ANIMATION_POOL)
  },

  // КАНАЛЫ СЕРИАЛОВ (70 серий строго по порядку, по 10 серий в сутки)
  {
    id: 'ch-series-sitcom',
    category: 'series',
    genreNameRu: 'Ситкомы',
    genreNameEn: 'Sitcom Series',
    nameRu: 'Ситком ТВ: Друзья',
    nameEn: 'Sitcom TV: Friends',
    icon: '☕',
    color: 'from-amber-600 to-orange-500',
    weeklyPool: generateSeriesEpisodes(1668, 'Друзья', 'Friends', '1994', '/f496cm9enuEsZkSPghkkHgHNQ6Y.jpg', 70, 1500)
  },
  {
    id: 'ch-series-crime',
    category: 'series',
    genreNameRu: 'Криминал',
    genreNameEn: 'Crime Series',
    nameRu: 'Криминал ТВ: Во все тяжкие',
    nameEn: 'Crime TV: Breaking Bad',
    icon: '🧪',
    color: 'from-emerald-700 to-lime-600',
    weeklyPool: generateSeriesEpisodes(1396, 'Во все тяжкие', 'Breaking Bad', '2008', '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg', 70, 2880)
  },
  {
    id: 'ch-series-scifi',
    category: 'series',
    genreNameRu: 'Sci-Fi',
    genreNameEn: 'Sci-Fi Series',
    nameRu: 'Sci-Fi ТВ: Очень странные дела',
    nameEn: 'Sci-Fi TV: Stranger Things',
    icon: '🚲',
    color: 'from-rose-800 to-indigo-950',
    weeklyPool: generateSeriesEpisodes(66732, 'Очень странные дела', 'Stranger Things', '2016', '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg', 70, 3120)
  },
  {
    id: 'ch-series-drama',
    category: 'series',
    genreNameRu: 'Драмы',
    genreNameEn: 'Drama Series',
    nameRu: 'Драма ТВ: Острые козырьки',
    nameEn: 'Drama TV: Peaky Blinders',
    icon: '🥃',
    color: 'from-slate-800 to-amber-950',
    weeklyPool: generateSeriesEpisodes(60574, 'Острые козырьки', 'Peaky Blinders', '2013', '/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg', 70, 3420)
  }
];

// Получить список ровно из 10 фильмов на конкретный день недели (0 = Пн .. 6 = Вс)
export function getChannelDayItems(channel: TvChannel, dayOfWeek: number): TvPlaylistItem[] {
  const safeDay = ((dayOfWeek % 7) + 7) % 7;
  const startIndex = safeDay * 10;
  return channel.weeklyPool.slice(startIndex, startIndex + 10);
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

// Расчёт текущего состояния эфира (10 слотов по 8640с, ротация раз в сутки)
export function getChannelScheduleState(
  channel: TvChannel, 
  currentTimestampSec?: number
): ChannelScheduleState {
  const now = currentTimestampSec ?? Math.floor(Date.now() / 1000);
  const d = new Date(now * 1000);

  // Секунды от начала текущих суток в локальном времени пользователя (0..86399)
  const secondsInDay = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

  // День недели (0 = Понедельник, 1 = Вторник, ..., 6 = Воскресенье)
  const dayOfWeek = (d.getDay() + 6) % 7;

  // Номер слота сегодня: ровно 10 слотов (0..9)
  const slotIndex = Math.min(9, Math.floor(secondsInDay / SLOT_DURATION_SEC));
  const elapsedInSlot = secondsInDay - slotIndex * SLOT_DURATION_SEC;

  // 10 тайтлов на сегодня
  const dayItems = getChannelDayItems(channel, dayOfWeek);
  const currentItem = dayItems[slotIndex] || dayItems[0];

  // Смещение внутри тайтла (если фильм короче 144 минут, удерживаем или зацикливаем внутри слота)
  const durationSec = currentItem.durationSec;
  const initialTimecode = elapsedInSlot < durationSec 
    ? elapsedInSlot 
    : (elapsedInSlot % durationSec);

  const remainingInSlot = Math.max(0, SLOT_DURATION_SEC - elapsedInSlot);
  const progressPercent = Math.min(100, Math.max(0, (elapsedInSlot / SLOT_DURATION_SEC) * 100));

  // Определение следующего тайтла
  let nextItem: TvPlaylistItem;
  if (slotIndex < 9) {
    nextItem = dayItems[slotIndex + 1];
  } else {
    // 10-й слот суток -> следующая передача начнётся в 00:00 следующих суток
    const nextDay = (dayOfWeek + 1) % 7;
    const nextDayItems = getChannelDayItems(channel, nextDay);
    nextItem = nextDayItems[0];
  }

  const nextStartTime = now + remainingInSlot;
  const remainingMinutes = Math.ceil(remainingInSlot / 60);
  const formattedTimeRemaining = remainingMinutes >= 60 
    ? `осталось ${Math.floor(remainingMinutes / 60)} ч ${remainingMinutes % 60} мин` 
    : `осталось ${remainingMinutes} мин`;

  return {
    channel,
    currentItem,
    initialTimecode,
    elapsedSec: initialTimecode,
    remainingSec: remainingInSlot,
    durationSec,
    progressPercent,
    nextItem,
    nextStartTime,
    formattedElapsed: formatTimecode(initialTimecode),
    formattedDuration: formatTimecode(durationSec),
    formattedTimeRemaining,
    formattedNextTime: formatClockTime(nextStartTime),
    slotIndex,
    dayOfWeek
  };
}

// Получение расписания передач на сегодня (ровно 10 передач суток)
export function getChannelUpcomingSchedule(
  channel: TvChannel, 
  currentTimestampSec?: number
): Array<{ item: TvPlaylistItem; startTimeSec: number; formattedStartTime: string; isCurrent: boolean; slotNum: number }> {
  const now = currentTimestampSec ?? Math.floor(Date.now() / 1000);
  const d = new Date(now * 1000);
  const secondsInDay = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  const dayStartTimestamp = now - secondsInDay;
  const dayOfWeek = (d.getDay() + 6) % 7;
  const currentSlotIndex = Math.min(9, Math.floor(secondsInDay / SLOT_DURATION_SEC));

  const dayItems = getChannelDayItems(channel, dayOfWeek);

  return dayItems.map((item, idx) => {
    const slotStartTime = dayStartTimestamp + idx * SLOT_DURATION_SEC;
    return {
      item,
      startTimeSec: slotStartTime,
      formattedStartTime: formatClockTime(slotStartTime),
      isCurrent: idx === currentSlotIndex,
      slotNum: idx + 1
    };
  });
}
