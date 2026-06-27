// Switch to production URL before deploying: 'https://evro90-nm6.hf.space/api/music'
const API_BASE = import.meta.env.PROD 
  ? 'https://evro90-nm6.hf.space/api/music' 
  : '/api/music';

export interface YTSong {
  videoId: string;
  name: string;
  artist: { name: string, artistId?: string };
  album?: { name: string, albumId?: string } | null;
  thumbnails: { url: string, width: number, height: number }[];
  duration?: number | null;
}

export interface YTSongDetails {
  id: string;
  title: string;
  artist: string;
  album: string;
  image: string;
  duration: number;
  streamUrl?: string;
}

export const musicService = {
  // Fetch Trending - 100 globally popular songs with daily rotation
  async getTrending(): Promise<YTSong[]> {
    try {
      const res = await fetch(`${API_BASE}/trending`);
      if (!res.ok) throw new Error('Network response was not ok');
      return await res.json();
    } catch (e) {
      console.error("Error fetching trending:", e);
      return [];
    }
  },

  // Fetch a thematic playlist
  async getPlaylist(name: string): Promise<YTSong[]> {
    try {
      const res = await fetch(`${API_BASE}/playlist/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error('Network response was not ok');
      return await res.json();
    } catch (e) {
      console.error(`Error fetching playlist ${name}:`, e);
      return [];
    }
  },

  // Search for songs with pagination
  async searchSongs(query: string, page = 1, limit = 20): Promise<YTSong[]> {
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error('Network response was not ok');
      const data = await res.json();
      return data || [];
    } catch (e) {
      console.error("Error searching songs:", e);
      return [];
    }
  },

  // Search for artists
  async searchArtists(query: string): Promise<any[]> {
    try {
      const res = await fetch(`${API_BASE}/artists/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Network response was not ok');
      const data = await res.json();
      return data || [];
    } catch (e) {
      console.error("Error searching artists:", e);
      return [];
    }
  },

  // Get artist full discography with pagination
  async getArtistSongs(artistId: string, page = 1, limit = 20): Promise<{ songs: YTSong[], total: number, hasMore: boolean }> {
    try {
      const res = await fetch(`${API_BASE}/artist/${encodeURIComponent(artistId)}/songs?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error('Network response was not ok');
      return await res.json();
    } catch (e) {
      console.error("Error fetching artist songs:", e);
      return { songs: [], total: 0, hasMore: false };
    }
  },

  // Get Playable Stream URL & High-Res Details
  async getSongDetails(id: string): Promise<YTSongDetails | null> {
    try {
      const res = await fetch(`${API_BASE}/song/${id}`);
      if (!res.ok) throw new Error('Network response was not ok');
      return await res.json();
    } catch (e) {
      console.error("Error fetching song details:", e);
      return null;
    }
  }
};
