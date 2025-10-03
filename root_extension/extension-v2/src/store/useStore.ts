import { create } from 'zustand';
import type { CreditCard, Recommendation } from '../types';

interface AppState {
  // State
  apiKey: string;
  cards: CreditCard[];
  recommendation: Recommendation | null;
  isLoading: boolean;
  error: string | null;
  showSettings: boolean;

  // Actions
  setApiKey: (key: string) => void;
  setCards: (cards: CreditCard[]) => void;
  setRecommendation: (recommendation: Recommendation | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setShowSettings: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  apiKey: '',
  cards: [],
  recommendation: null,
  isLoading: false,
  error: null,
  showSettings: false,
};

/**
 * Global application store using Zustand
 */
export const useStore = create<AppState>((set) => ({
  ...initialState,

  setApiKey: (key) => set({ apiKey: key }),

  setCards: (cards) => set({ cards }),

  setRecommendation: (recommendation) => set({ recommendation }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  setShowSettings: (show) => set({ showSettings: show }),

  reset: () => set(initialState),
}));
