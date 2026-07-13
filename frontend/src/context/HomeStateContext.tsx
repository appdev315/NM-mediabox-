import React, { createContext, useContext, useState, useEffect } from 'react';

type TabType = 'movie' | 'series' | 'radio' | 'tv';

interface HomeState {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  items: any[];
  setItems: React.Dispatch<React.SetStateAction<any[]>>;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  selectedGenre: string;
  setSelectedGenre: (genre: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isSearching: boolean;
  setIsSearching: (searching: boolean) => void;
  scrollY: number;
  setScrollY: (y: number) => void;
  resetHomeState: () => void;
}

const HomeStateContext = createContext<HomeState | undefined>(undefined);

export const HomeStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTabState] = useState<TabType>(() => {
    return (localStorage.getItem('mb_home_activeTab') as TabType) || 'movie';
  });

  const [items, setItems] = useState<any[]>(() => {
    const saved = localStorage.getItem('mb_home_items');
    return saved ? JSON.parse(saved) : [];
  });

  const [page, setPage] = useState<number>(() => {
    const saved = localStorage.getItem('mb_home_page');
    return saved ? parseInt(saved, 10) : 1;
  });

  const [selectedGenre, setSelectedGenreState] = useState<string>(() => {
    return localStorage.getItem('mb_home_selectedGenre') || '';
  });

  const [searchQuery, setSearchQueryState] = useState<string>(() => {
    return localStorage.getItem('mb_home_searchQuery') || '';
  });

  const [isSearching, setIsSearchingState] = useState<boolean>(() => {
    return localStorage.getItem('mb_home_isSearching') === 'true';
  });

  const [scrollY, setScrollY] = useState<number>(0);

  useEffect(() => {
    localStorage.setItem('mb_home_activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('mb_home_items', JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    localStorage.setItem('mb_home_page', String(page));
  }, [page]);

  useEffect(() => {
    localStorage.setItem('mb_home_selectedGenre', selectedGenre);
  }, [selectedGenre]);

  useEffect(() => {
    localStorage.setItem('mb_home_searchQuery', searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    localStorage.setItem('mb_home_isSearching', String(isSearching));
  }, [isSearching]);

  const setActiveTab = (tab: TabType) => {
    setActiveTabState(tab);
    setPage(1);
    setItems([]);
    setSelectedGenreState('');
    setSearchQueryState('');
    setIsSearchingState(false);
    setScrollY(0);
  };

  const setSelectedGenre = (genre: string) => {
    setSelectedGenreState(genre);
    setPage(1);
    setItems([]);
    setScrollY(0);
  };

  const setSearchQuery = (query: string) => {
    setSearchQueryState(query);
    setPage(1);
    setScrollY(0);
  };

  const setIsSearching = (searching: boolean) => {
    setIsSearchingState(searching);
  };

  const resetHomeState = () => {
    setActiveTabState('movie');
    setItems([]);
    setPage(1);
    setSelectedGenreState('');
    setSearchQueryState('');
    setIsSearchingState(false);
    setScrollY(0);
    localStorage.removeItem('mb_home_activeTab');
    localStorage.removeItem('mb_home_items');
    localStorage.removeItem('mb_home_page');
    localStorage.removeItem('mb_home_selectedGenre');
    localStorage.removeItem('mb_home_searchQuery');
    localStorage.removeItem('mb_home_isSearching');
  };

  return (
    <HomeStateContext.Provider
      value={{
        activeTab,
        setActiveTab,
        items,
        setItems,
        page,
        setPage,
        selectedGenre,
        setSelectedGenre,
        searchQuery,
        setSearchQuery,
        isSearching,
        setIsSearching,
        scrollY,
        setScrollY,
        resetHomeState,
      }}
    >
      {children}
    </HomeStateContext.Provider>
  );
};

export const useHomeState = () => {
  const context = useContext(HomeStateContext);
  if (!context) {
    throw new Error('useHomeState must be used within a HomeStateProvider');
  }
  return context;
};
