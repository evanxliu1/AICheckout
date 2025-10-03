import { create } from 'zustand';
import type { CreditCard, Recommendation, CartItem } from '../types';

interface AppState {
  // State
  apiKey: string;
  cards: CreditCard[];
  recommendation: Recommendation | null;
  cartItems: CartItem[] | null;
  isLoading: boolean;
  error: string | null;
  showSettings: boolean;

  // Actions
  setApiKey: (key: string) => void;
  setCards: (cards: CreditCard[]) => void;
  setRecommendation: (recommendation: Recommendation | null) => void;
  setCartItems: (items: CartItem[] | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setShowSettings: (show: boolean) => void;
  reset: () => void;
}

const initialState = {
  apiKey: '',
  cards: [],
  recommendation: null,
  cartItems: null,
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

  setCartItems: (items) => set({ cartItems: items }),

  setLoading: (loading) => set({ isLoading: loading }),

  setError: (error) => set({ error }),

  setShowSettings: (show) => set({ showSettings: show }),

  reset: () => set(initialState),
}));
