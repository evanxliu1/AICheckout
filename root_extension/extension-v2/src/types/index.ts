// Core type definitions for Credit Card Recommender extension

export interface CreditCard {
  id?: string;
  name: string;
  annualFee: number;
  rewards: {
    [category: string]: string;
  };
  description: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CartItem {
  name: string;
  price?: string;
  quantity?: number;
  description?: string;
}

export interface Recommendation {
  card: string;
  rewards: {
    [category: string]: string;
  };
  merchant: string;
  category: string;
  reasoning?: string; // Why this card was chosen
  timestamp?: number; // When recommendation was made
}

export interface RecommendationRequest {
  cartItems: CartItem[];
  site: string;
  cards: CreditCard[];
}

export interface APIResponse<T = any> {
  data?: T;
  error?: string;
  success: boolean;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: OpenAIMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Chrome storage types
export interface StorageData {
  openaiKey?: string;
  cachedCards?: CreditCard[];
  latestRecommendation?: string;
  lastCardsFetch?: number;
  recommendationLogs?: RecommendationLog[];
  debugMode?: boolean;
}

// Recommendation logging for debugging
export interface RecommendationLog {
  timestamp: number;
  site: string;
  cartItems: CartItem[];
  recommendation: Recommendation;
  allCards: { name: string; rewards: Record<string, string> }[];
  prompt: string;
  rawResponse: string;
}

// Message passing types for content scripts
export interface ExtensionMessage {
  type: 'EXTRACT_CART' | 'BUILD_PROMPT' | 'CALL_OPENAI' | 'CREATE_BANNER';
  payload?: any;
}

export interface ExtensionMessageResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// Extractor types
export interface ExtractorConfig {
  siteId: string;
  urlPatterns: string[];
  displayName: string;
  itemSelector: string;
  brandSelector?: string;
  nameSelector: string;
  priceSelector?: string;
  quantitySelector?: string;
  combineBrandName?: boolean;
  customNameExtractor?: (element: Element) => string | null;
  customPriceExtractor?: (element: Element) => string | null;
  customQuantityExtractor?: (element: Element) => number | null;
}

export interface ExtractionResult {
  items: CartItem[];
  extractorId: string;
  success: boolean;
  error?: string;
  duration?: number;
}

export interface ExtractorMetadata {
  siteId: string;
  displayName: string;
  urlPatterns: string[];
  version?: string;
  author?: string;
}
