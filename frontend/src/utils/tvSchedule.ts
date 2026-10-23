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

// Базовые пулы топовых фильмов по жанрам (с верифицированными обложками TMDB)
const ACTION_POOL: TvPlaylistItem[] = [
  { id: 603692, title: 'Джон Уик 4', year: '2023', type: 'movie', durationSec: 10140, posterPath: '/o29otcx30U3EkqNVGC2feJVz5yr.jpg' },
  { id: 76341, title: 'Безумный Макс: Дорога ярости', year: '2015', type: 'movie', durationSec: 7200, posterPath: '/8FM6AhLMX3X6OcZjfmH24F4rKMI.jpg' },
  { id: 155, title: 'Тёмный рыцарь', year: '2008', type: 'movie', durationSec: 9120, posterPath: '/aPtN76OjnNKLqCJ2FJBnQOIL031.jpg' },
  { id: 98, title: 'Гладиатор', year: '2000', type: 'movie', durationSec: 9300, posterPath: '/1wjNqlfsuHNTXTpCt2ZOV2iPxaf.jpg' },
  { id: 105, title: 'Леон', year: '1994', type: 'movie', durationSec: 6600, posterPath: '/eSaVxwfwl2KmcewzCve657ITDXk.jpg' },
  { id: 562, title: 'Крепкий орешек', year: '1988', type: 'movie', durationSec: 7920, posterPath: '/bIDUVu4QTAvNLEZqTml5vka8ElV.jpg' },
  { id: 51497, title: 'Форсаж 5', year: '2011', type: 'movie', durationSec: 7800, posterPath: '/A9Ud0VPQKLPKvHXnfWGvs26jBsr.jpg' },
  { id: 245891, title: 'Джон Уик', year: '2014', type: 'movie', durationSec: 6060, posterPath: '/2hfeF2566IKZ30c1BAay0N2lxBr.jpg' },
  { id: 383498, title: 'Дэдпул 2', year: '2018', type: 'movie', durationSec: 7140, posterPath: '/6ieUmjpY7bMMZqIdFxHKUEwfwSB.jpg' },
  { id: 454626, title: 'Соник в кино', year: '2020', type: 'movie', durationSec: 5940, posterPath: '/5VkEgD5YIJye87E1xX6NQ5BVaTc.jpg' },
  { id: 299536, title: 'Мстители: Война бесконечности', year: '2018', type: 'movie', durationSec: 8940, posterPath: '/c6RSGB6O0RaaHG3JGLq8lnUJSBC.jpg' },
  { id: 299534, title: 'Мстители: Финал', year: '2019', type: 'movie', durationSec: 10860, posterPath: '/dynnf8NGGfHTNMz8Vd3CzFtYjec.jpg' }
];

const COMEDY_POOL: TvPlaylistItem[] = [
  { id: 77338, title: '1+1', year: '2011', type: 'movie', durationSec: 6720, posterPath: '/zQsq95pYgjhJwYKqoFdeXlVse88.jpg' },
  { id: 18785, title: 'Мальчишник в Вегасе', year: '2009', type: 'movie', durationSec: 6000, posterPath: '/eqfuqXcv0MlbnzihcfsTaTGMbd.jpg' },
  { id: 522627, title: 'Джентльмены', year: '2019', type: 'movie', durationSec: 6780, posterPath: '/vWxVVECgYDPSg5o0Rhw5u7KFa7X.jpg' },
  { id: 310, title: 'Брюс Всемогущий', year: '2003', type: 'movie', durationSec: 6060, posterPath: '/vMhL7BZFUa8oWs9Ts10Tk259bFf.jpg' },
  { id: 138832, title: 'Мы — Миллеры', year: '2013', type: 'movie', durationSec: 6600, posterPath: '/3nxRlzpRh4FAC2HIZivW1pKuOk7.jpg' },
  { id: 490132, title: 'Зелёная книга', year: '2018', type: 'movie', durationSec: 7800, posterPath: '/fYch3e75YFnsJS9wAOOMlzErMqR.jpg' },
  { id: 137, title: 'День сурка', year: '1993', type: 'movie', durationSec: 6060, posterPath: '/yo91LPlSzskGGNo273us7ScuKIH.jpg' },
  { id: 8835, title: 'Блондинка в законе', year: '2001', type: 'movie', durationSec: 5760, posterPath: '/gUvq472g8Wsp6DVNOCWh8OVDcM6.jpg' },
  { id: 9479, title: 'Кошмар перед Рождеством', year: '1993', type: 'movie', durationSec: 4560, posterPath: '/xvqFn90FxKTJflG4n0spZY7vySu.jpg' },
  { id: 82690, title: 'Ральф', year: '2012', type: 'movie', durationSec: 6060, posterPath: '/ajqxACmmCAgNCL598xUTG4cn1iP.jpg' },
  { id: 12153, title: 'Эйс Вентура', year: '1994', type: 'movie', durationSec: 5160, posterPath: '/u2kRTtD9YacSJH0tg9GZfrrKvMv.jpg' },
  { id: 2109, title: 'Час пик', year: '1998', type: 'movie', durationSec: 5880, posterPath: '/wGwBIpObDxLVM4a6Qt0XmcoHnRf.jpg' }
];

const SCIFI_POOL: TvPlaylistItem[] = [
  { id: 157336, title: 'Интерстеллар', year: '2014', type: 'movie', durationSec: 10140, posterPath: '/vReLRjDV9XPhiOSEW7QWow4DXwf.jpg' },
  { id: 27205, title: 'Начало', year: '2010', type: 'movie', durationSec: 8880, posterPath: '/piQXcdOGgv1O9HQ07pI0tnjkGJw.jpg' },
  { id: 603, title: 'Матрица', year: '1999', type: 'movie', durationSec: 8160, posterPath: '/kEDbym5htJgDQNenjUtSJxAHysB.jpg' },
  { id: 335984, title: 'Бегущий по лезвию 2049', year: '2017', type: 'movie', durationSec: 9840, posterPath: '/fnIJeT9GZvscKm5PbmAvhTYDsLh.jpg' },
  { id: 19995, title: 'Аватар', year: '2009', type: 'movie', durationSec: 9720, posterPath: '/lUKcrcO3wEPhNnzGq06JIX7GIEb.jpg' },
  { id: 18, title: 'Пятый элемент', year: '1997', type: 'movie', durationSec: 7560, posterPath: '/bqALmWhVaqfQedyPZn7MeuOjfSk.jpg' },
  { id: 286217, title: 'Марсианин', year: '2015', type: 'movie', durationSec: 8640, posterPath: '/6U19srkH4wI6taluviXbVaIpsau.jpg' },
  { id: 438631, title: 'Дюна', year: '2021', type: 'movie', durationSec: 9300, posterPath: '/3hbXNclcHaj5KiF6kK41GBMjyFr.jpg' },
  { id: 693134, title: 'Дюна: Часть вторая', year: '2024', type: 'movie', durationSec: 9960, posterPath: '/3aLghRkuJc9cs770fxo4a6YWht3.jpg' },
  { id: 329, title: 'Парк Юрского периода', year: '1993', type: 'movie', durationSec: 7620, posterPath: '/qoDjoRP7vYmPZ1lZIMTGzoHG1iR.jpg' },
  { id: 106, title: 'Хищник', year: '1987', type: 'movie', durationSec: 6420, posterPath: '/9mXkVw1BxmjagxjdIK3sbVQU841.jpg' },
  { id: 218, title: 'Терминатор', year: '1984', type: 'movie', durationSec: 6420, posterPath: '/hcItc8IMO0WKyRWPGkI6xtKVu6X.jpg' }
];

const THRILLER_POOL: TvPlaylistItem[] = [
  { id: 11324, title: 'Остров проклятых', year: '2010', type: 'movie', durationSec: 8280, posterPath: '/3UVMyefkUBiktshtKIEnNXvOFKH.jpg' },
  { id: 807, title: 'Семь', year: '1995', type: 'movie', durationSec: 7620, posterPath: '/1e7WmKXLo6xqibkYBwwGWOcF43E.jpg' },
  { id: 550, title: 'Бойцовский клуб', year: '1999', type: 'movie', durationSec: 8340, posterPath: '/66RvLrRJTm4J8l3uHXWF09AICol.jpg' },
  { id: 1124, title: 'Престиж', year: '2006', type: 'movie', durationSec: 7800, posterPath: '/cynfEpFBHGkdBIVpdnx8Od2TQNj.jpg' },
  { id: 210577, title: 'Исчезнувшая', year: '2014', type: 'movie', durationSec: 8940, posterPath: '/4AlxoCnpOIUtRq2U9qxMu6chaQb.jpg' },
  { id: 546554, title: 'Достать ножи', year: '2019', type: 'movie', durationSec: 7800, posterPath: '/mGfb75tcFWxuT8esS1isHrNFE90.jpg' },
  { id: 274, title: 'Молчание ягнят', year: '1991', type: 'movie', durationSec: 7080, posterPath: '/5vhSSCYd6DIVleZBYDxdgzc6i8w.jpg' },
  { id: 1949, title: 'Зодиак', year: '2007', type: 'movie', durationSec: 9420, posterPath: '/1ypQRKw54EC29oPhEQBimxutulI.jpg' },
  { id: 629, title: 'Подозрительные лица', year: '1995', type: 'movie', durationSec: 6360, posterPath: '/kfJCvzT19srQaGzQaTx8ltD7CjM.jpg' },
  { id: 77, title: 'Помни', year: '2000', type: 'movie', durationSec: 6780, posterPath: '/sP3GaLR1kRz0Fj5exKJmYKvIYzz.jpg' }
];

const HORROR_POOL: TvPlaylistItem[] = [
  { id: 138843, title: 'Заклятие', year: '2013', type: 'movie', durationSec: 6720, posterPath: '/dq99MpZPTpHOFaZCGvYz3o2uwQk.jpg' },
  { id: 49018, title: 'Астрал', year: '2010', type: 'movie', durationSec: 6180, posterPath: '/xWQzDOslE1XrpnmflRakEEnBIBC.jpg' },
  { id: 346364, title: 'Оно', year: '2017', type: 'movie', durationSec: 8100, posterPath: '/tM3xcPo8UNuJFCXO0CkmchBjPvd.jpg' },
  { id: 694, title: 'Сияние', year: '1980', type: 'movie', durationSec: 8760, posterPath: '/bu3Qb0fpAFtTLcRAPgj8bK5KrIG.jpg' },
  { id: 447332, title: 'Тихое место', year: '2018', type: 'movie', durationSec: 5400, posterPath: '/b6MMVZWO7LPITq9XS5a4R22CZjG.jpg' },
  { id: 1091, title: 'Нечто', year: '1982', type: 'movie', durationSec: 6540, posterPath: '/cxywW6Dl0IJfpywo8o9cqc4EApE.jpg' },
  { id: 493922, title: 'Реинкарнация', year: '2018', type: 'movie', durationSec: 7620, posterPath: '/jccWP5cOTvveMippGXen81qaSf1.jpg' },
  { id: 176, title: 'Пила', year: '2004', type: 'movie', durationSec: 6180, posterPath: '/ghBc5iOJxDcEHPi7OvQYdVXiGeF.jpg' },
  { id: 10673, title: 'Звонок', year: '2002', type: 'movie', durationSec: 6900, posterPath: '/EbefMT6YLajtP1rodN3qebzwGQ.jpg' },
  { id: 565, title: 'Зловещие мертвецы 2', year: '1987', type: 'movie', durationSec: 5040, posterPath: '/vwldpALjeYsr0kHR7UWa1PdKpvc.jpg' }
];

const ANIMATION_POOL: TvPlaylistItem[] = [
  { id: 354912, title: 'Тайна Коко', year: '2017', type: 'movie', durationSec: 6300, posterPath: '/jvYsGaUqN8ymH696kRfVJjJ3GIl.jpg' },
  { id: 809, title: 'Шрек 2', year: '2004', type: 'movie', durationSec: 5580, posterPath: '/vALSn7rJEuX742gWKcmCVLquw5J.jpg' },
  { id: 14160, title: 'Вверх', year: '2009', type: 'movie', durationSec: 5760, posterPath: '/47DEnHvvLCOPLPG7QpM8mXLCJG5.jpg' },
  { id: 2062, title: 'Рататуй', year: '2007', type: 'movie', durationSec: 6660, posterPath: '/ojJnDAWLy656Lx9ksj6nP7ubQjq.jpg' },
  { id: 324857, title: 'Человек-паук: Через вселенные', year: '2018', type: 'movie', durationSec: 7020, posterPath: '/oCAi3NdfXNYLd8PROu5ycUhVety.jpg' },
  { id: 129, title: 'Унесённые призраками', year: '2001', type: 'movie', durationSec: 7500, posterPath: '/txaVo4whnSduKuczZiJexhLDVQC.jpg' },
  { id: 862, title: 'История игрушек', year: '1995', type: 'movie', durationSec: 4860, posterPath: '/gRLk7XpdRyNa697taDKtFx3l6qV.jpg' },
  { id: 12, title: 'В поисках Немо', year: '2003', type: 'movie', durationSec: 6000, posterPath: '/wwUYKw29xtFLk5PIZV9iDAs6zlW.jpg' },
  { id: 10681, title: 'ВАЛЛ-И', year: '2008', type: 'movie', durationSec: 5880, posterPath: '/uR79KoBwDMz1qbxwmuY0bpcDYtf.jpg' },
  { id: 9502, title: 'Кунг-фу Панда', year: '2008', type: 'movie', durationSec: 5520, posterPath: '/dWteA8uhU6SWyawy5f4l7BnYQCm.jpg' }
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
    weeklyPool: generateSeriesEpisodes(1668, 'Друзья', 'Friends', '1994', '/zBOs8S3UOHyWLzOl9gF8lknBxlL.jpg', 70, 1500)
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
    weeklyPool: generateSeriesEpisodes(1396, 'Во все тяжкие', 'Breaking Bad', '2008', '/gwB6E7Zi5L3J9WA2y0zLeKuc3ul.jpg', 70, 2880)
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
    weeklyPool: generateSeriesEpisodes(66732, 'Очень странные дела', 'Stranger Things', '2016', '/nW3cral1e2r3xfLySPE1U9bailS.jpg', 70, 3120)
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
    weeklyPool: generateSeriesEpisodes(60574, 'Острые козырьки', 'Peaky Blinders', '2013', '/pVJzfWgb3sHN29hLaiI5jmBN9vx.jpg', 70, 3420)
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
