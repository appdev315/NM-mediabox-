import { CF_API_BASE } from '../hooks/useApi';
import { WebApp } from '../telegram';

const STORAGE_KEYS: Record<string, string> = {
  movie: 'favorites_movies',
  series: 'favorites_series',
  radio: 'favorites_radio',
  tv: 'favorites_tv',
  adult: 'adult_favorites',
};

export const favoritesManager = {
  // 1. Instant 0ms Read from Local Storage
  getLocal(type: string): any[] {
    const key = STORAGE_KEYS[type] || `favorites_${type}`;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('[FavoritesManager] Local read error:', e);
      return [];
    }
  },

  // 2. Local Save + Background Cloud Sync
  add(type: string, item: any): any[] {
    const key = STORAGE_KEYS[type] || `favorites_${type}`;
    const list = this.getLocal(type);
    const itemId = String(item.id);

    if (!list.some(i => String(i.id) === itemId)) {
      const updated = [item, ...list];
      try {
        localStorage.setItem(key, JSON.stringify(updated));
      } catch (e) {}

      // Non-blocking background sync to Cloudflare D1
      this.syncItemToCloud('POST', type, item);
      return updated;
    }
    return list;
  },

  // 3. Local Remove + Background Cloud Sync
  remove(type: string, itemId: string | number): any[] {
    const key = STORAGE_KEYS[type] || `favorites_${type}`;
    const list = this.getLocal(type);
    const targetId = String(itemId);

    const updated = list.filter(i => String(i.id) !== targetId);
    try {
      localStorage.setItem(key, JSON.stringify(updated));
    } catch (e) {}

    // Non-blocking background sync to Cloudflare D1
    this.syncItemToCloud('DELETE', type, { id: targetId });
    return updated;
  },

  // 4. Check if item is in favorites
  isFavorite(type: string, itemId: string | number): boolean {
    const list = this.getLocal(type);
    const targetId = String(itemId);
    return list.some(i => String(i.id) === targetId);
  },

  // 5. Non-blocking Cloud Sync Helper
  async syncItemToCloud(method: 'POST' | 'DELETE', type: string, item: any): Promise<void> {
    try {
      const initData = WebApp?.initData || '';
      await fetch(`${CF_API_BASE}/user/favorites`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${initData}`,
        },
        body: JSON.stringify({ ...item, type }),
      });
    } catch (e) {
      console.warn('[FavoritesManager] Background cloud sync deferred (offline or server unavailable)');
    }
  },

  // 6. Restore / Merge with Cloud Backup on App Launch
  async hydrateFromCloud(type: string): Promise<any[]> {
    const localItems = this.getLocal(type);
    try {
      const initData = WebApp?.initData || '';
      if (!initData) return localItems;

      const res = await fetch(`${CF_API_BASE}/user/favorites`, {
        headers: { 'Authorization': `Bearer ${initData}` }
      });

      if (!res.ok) return localItems;
      const data = await res.json();
      const cloudItems: any[] = data.favorites || [];

      if (!Array.isArray(cloudItems) || cloudItems.length === 0) return localItems;

      // Merge Cloud & Local (Local entries take precedence, missing cloud entries get appended)
      const mergedMap = new Map<string, any>();
      localItems.forEach(item => mergedMap.set(String(item.id), item));
      cloudItems.forEach(item => {
        const id = String(item.id);
        if (!mergedMap.has(id) && item.type === type) {
          mergedMap.set(id, item);
        }
      });

      const mergedList = Array.from(mergedMap.values());
      const key = STORAGE_KEYS[type] || `favorites_${type}`;
      localStorage.setItem(key, JSON.stringify(mergedList));
      return mergedList;
    } catch (e) {
      return localItems;
    }
  }
};
