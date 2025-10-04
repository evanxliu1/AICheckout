import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { getOpenAIKey } from '../utils/storage';
import { cardAPI } from '../services/api';
import ErrorBoundary from '../components/ErrorBoundary';
import LoadingState from '../components/LoadingState';
import RecommendationCard from '../components/RecommendationCard';
import CartItemsList from '../components/CartItemsList';
import SettingsModal from '../components/SettingsModal';
import { DebugPanel } from '../components/DebugPanel';
import type { CartItem, Recommendation } from '../types';

/**
 * Main Popup component for the extension
 */
const Popup: React.FC = () => {
  const {
    recommendation,
    cartItems,
    isLoading,
    error,
    showSettings,
    setRecommendation,
    setCartItems,
    setLoading,
    setError,
    setShowSettings,
  } = useStore();

  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    // Check for API key on mount
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    try {
      const key = await getOpenAIKey();
      setHasApiKey(!!key);

      if (!key) {
        setError('OpenAI API key not configured. Please add your API key in settings.');
      }
    } catch (err) {
      console.error('Error checking API key:', err);
      setError('Failed to check API key');
    }
  };

  const handleGetRecommendation = async () => {
    setLoading(true);
    setError(null);
    setCartItems(null);

    try {
      // Check API key again
      const apiKey = await getOpenAIKey();
      if (!apiKey) {
        throw new Error('OpenAI API key not configured');
      }

      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) {
        throw new Error('No active tab found');
      }

      const site = new URL(tab.url).hostname;

      // Check if content script is ready, retry if not
      let retries = 0;
      const maxRetries = 5;

      while (retries < maxRetries) {
        const checkResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => typeof (window as any).__CC_extractCartItems === 'function',
        });

        if (checkResults[0]?.result) {
          break; // Content script is ready
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
        retries++;
      }

      if (retries === maxRetries) {
        throw new Error('Content script not loaded. Try refreshing the page.');
      }

      // Extract cart items from page
      const cartResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return (window as any).__CC_extractCartItems?.() || [];
        },
      });

      const extractedItems: CartItem[] = cartResults[0]?.result || [];
      console.log('Extracted cart items:', extractedItems);

      if (extractedItems.length === 0) {
        setError(
          'No cart items found on this page. Try visiting a shopping cart or checkout page.'
        );
        setLoading(false);
        return;
      }

      // Store cart items in state
      setCartItems(extractedItems);

      // Get recommendation
      const rec = await cardAPI.getRecommendation(extractedItems, site, apiKey);
      setRecommendation(rec);

      // Also create banner on page
      const bannerHtml = createBannerHtml(rec);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (html: string) => {
          (window as any).__CC_createBanner?.(html);
        },
        args: [bannerHtml],
      });
    } catch (err) {
      console.error('Error getting recommendation:', err);
      setError(err instanceof Error ? err.message : 'Failed to get recommendation');
      setCartItems(null);
    } finally {
      setLoading(false);
    }
  };

  const createBannerHtml = (rec: Recommendation): string => {
    const rewardsHtml = Object.entries(rec.rewards)
      .map(
        ([cat, val]) => `
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="text-transform: capitalize;">${cat}</span>
          <strong style="color: #2563eb;">${val}</strong>
        </div>
      `
      )
      .join('');

    return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
        <div style="margin-bottom: 8px;">
          <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Best Card</div>
          <div style="font-size: 18px; font-weight: bold; color: #111827;">${rec.card}</div>
        </div>
        <div style="background: linear-gradient(to right, #eff6ff, #dbeafe); padding: 12px; border-radius: 6px; margin-bottom: 8px;">
          <div style="font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; margin-bottom: 8px;">Rewards</div>
          ${rewardsHtml}
        </div>
        <div style="font-size: 11px; color: #6b7280; text-align: center; padding-top: 8px; border-top: 1px solid #e5e7eb;">
          AI-powered recommendation
        </div>
      </div>
    `;
  };

  return (
    <ErrorBoundary>
      <div className="min-h-[300px] bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg
                className="w-6 h-6 text-primary-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                <path
                  fillRule="evenodd"
                  d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
                  clipRule="evenodd"
                />
              </svg>
              <h1 className="text-lg font-bold text-gray-900">Credit Card AI</h1>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {isLoading ? (
            <LoadingState message="Analyzing your cart..." variant="skeleton" />
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="flex-1">
                  <p className="text-sm text-red-800">{error}</p>
                  {!hasApiKey && (
                    <button
                      onClick={() => setShowSettings(true)}
                      className="mt-2 text-sm text-red-600 hover:text-red-700 underline"
                    >
                      Configure API Key
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : recommendation ? (
            <>
              {cartItems && cartItems.length > 0 && (
                <div className="mb-4">
                  <CartItemsList items={cartItems} />
                </div>
              )}
              <RecommendationCard recommendation={recommendation} />
              <DebugPanel
                currentRecommendation={{
                  card: recommendation.card,
                  category: recommendation.category,
                  reasoning: recommendation.reasoning
                }}
              />
            </>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 bg-primary-100 rounded-full flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-primary-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Get AI-Powered Card Recommendation
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Click below to analyze your cart and find the best credit card for maximum rewards.
              </p>
              <button
                onClick={handleGetRecommendation}
                disabled={!hasApiKey}
                className="btn-primary"
              >
                Get Recommendation
              </button>
            </div>
          )}

          {/* Retry button when there's a recommendation */}
          {recommendation && !isLoading && (
            <div className="mt-4 text-center">
              <button
                onClick={handleGetRecommendation}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                Refresh Recommendation
              </button>
            </div>
          )}
        </div>

        {/* Settings Modal */}
        <SettingsModal
          isOpen={showSettings}
          onClose={() => {
            setShowSettings(false);
            checkApiKey(); // Re-check API key after closing settings
          }}
        />
      </div>
    </ErrorBoundary>
  );
};

export default Popup;
