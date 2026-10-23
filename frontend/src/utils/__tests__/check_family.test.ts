import { describe, it } from 'vitest';
import { TV_CHANNELS, getChannelScheduleState } from '../tvSchedule';

describe('Check Family Channels', () => {
  it('checks ch-family and ch-series-family', () => {
    const familyMovie = TV_CHANNELS.find(c => c.id === 'ch-family')!;
    const familySeries = TV_CHANNELS.find(c => c.id === 'ch-series-family')!;

    const stateMovie = getChannelScheduleState(familyMovie);
    console.log('ch-family (movie):', {
      id: stateMovie.currentItem.id,
      title: stateMovie.currentItem.title,
      type: stateMovie.currentItem.type,
      year: stateMovie.currentItem.year,
      duration: stateMovie.currentItem.durationSec
    });

    const stateSeries = getChannelScheduleState(familySeries);
    console.log('ch-series-family (series):', {
      id: stateSeries.currentItem.id,
      title: stateSeries.currentItem.title,
      type: stateSeries.currentItem.type,
      year: stateSeries.currentItem.year,
      season: stateSeries.currentItem.season,
      episode: stateSeries.currentItem.episode,
      duration: stateSeries.currentItem.durationSec
    });
  });
});
