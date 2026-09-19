import React, { createContext, useContext, useState, useEffect } from 'react';

type TabType = 'movie' | 'series' | 'radio' | 'tv';

const VALID_TABS: readonly TabType[] = ['movie', 'series', 'radio', 'tv'];

interface HomeState {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  items: any[];
  setItems: React.Dispatch<React.SetStateAction<any[]>>;
  homeSections: any[];
  setHomeSections: React.Dispatch<React.SetStateAction<any[]>>;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  selectedGenre: string;
  setSelectedGenre: (genre: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isSearching: boolean;
  setIsSearching: (searching: boolean) => void;
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  scrollY: number;
  setScrollY: (y: number) => void;
}

const HomeStateContext = createContext<HomeState | undefined>(undefined);

export const HomeStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {

  const [activeTab, setActiveTabState] = useState<TabType>(() => {
    const saved = localStorage.getItem('mb_home_activeTab') as TabType;
    if (VALID_TABS.includes(saved)) {
      return saved;
    }
    try {
      localStorage.setItem('mb_home_activeTab', 'movie');
    } catch { }
    return 'movie';
  });

  const [items, setItems] = useState<any[]>([]);
  const [homeSections, setHomeSections] = useState<any[]>([]);
  const [page, setPage] = useState<number>(1);
  const [selectedGenre, setSelectedGenreState] = useState<string>('');
  const [searchQuery, setSearchQueryState] = useState<string>('');
  const [isSearching, setIsSearchingState] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpenState] = useState<boolean>(false);
  const [scrollY, setScrollY] = useState<number>(0);

  useEffect(() => {
    localStorage.setItem('mb_home_activeTab', activeTab);
  }, [activeTab]);

  const setActiveTab = (tab: TabType) => {
    setActiveTabState(tab);
    setPage(1);
    setItems([]);
    setHomeSections([]);
    setSelectedGenreState('');
    setSearchQueryState('');
    setIsSearchingState(false);
    setIsSearchOpenState(false);
    setScrollY(0);
  };

  const setSelectedGenre = (genre: string) => {
    setSelectedGenreState(genre);
    setPage(1);
    setItems([]);
    setHomeSections([]);
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

  const setIsSearchOpen = (open: boolean) => {
    setIsSearchOpenState(open);
  };

  return (
    <HomeStateContext.Provider
      value={{
        activeTab,
        setActiveTab,
        items,
        setItems,
        homeSections,
        setHomeSections,
        page,
        setPage,
        selectedGenre,
        setSelectedGenre,
        searchQuery,
        setSearchQuery,
        isSearching,
        setIsSearching,
        isSearchOpen,
        setIsSearchOpen,
        scrollY,
        setScrollY,
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
