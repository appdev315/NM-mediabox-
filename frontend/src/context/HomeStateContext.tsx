import React, { createContext, useContext, useState, useEffect } from 'react';

type TabType = 'movie' | 'series' | 'radio' | 'tv';

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
  selectedCountry: string;
  setSelectedCountry: (country: string) => void;
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

  const [items, setItems] = useState<any[]>([]);
  const [homeSections, setHomeSections] = useState<any[]>([]);
  const [page, setPage] = useState<number>(1);
  const [selectedGenre, setSelectedGenreState] = useState<string>('');
  const [selectedCountry, setSelectedCountryState] = useState<string>('');
  const [searchQuery, setSearchQueryState] = useState<string>('');
  const [isSearching, setIsSearchingState] = useState<boolean>(false);
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
    setScrollY(0);
  };

  const setSelectedGenre = (genre: string) => {
    setSelectedGenreState(genre);
    setPage(1);
    setItems([]);
    setHomeSections([]);
    setScrollY(0);
  };

  const setSelectedCountry = (country: string) => {
    setSelectedCountryState(country);
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

  const resetHomeState = () => {
    setActiveTabState('movie');
    setItems([]);
    setHomeSections([]);
    setPage(1);
    setSelectedGenreState('');
    setSelectedCountryState('');
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
        homeSections,
        setHomeSections,
        page,
        setPage,
        selectedGenre,
        setSelectedGenre,
        selectedCountry,
        setSelectedCountry,
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
