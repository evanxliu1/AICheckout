// Background service worker for Credit Card Recommender extension
// Handles extension lifecycle and message passing

import type { ExtensionMessage, ExtensionMessageResponse } from '../types';

// Extension installation handler
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Credit Card Recommender installed:', details.reason);

  if (details.reason === 'install') {
    // First time installation
    console.log('First time installation - initializing storage');
    chrome.storage.local.set({
      openaiKey: '',
      cachedCards: [],
      lastCardsFetch: 0
    });
  } else if (details.reason === 'update') {
    // Extension updated
    console.log('Extension updated from:', details.previousVersion);
  }
});

// Extension startup handler
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension started');
});

// Message passing handler for communication with popup and content scripts
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ExtensionMessageResponse) => void
  ) => {
    console.log('Background received message:', message.type, 'from:', sender.tab?.id || 'popup');

    // Handle different message types
    switch (message.type) {
      case 'EXTRACT_CART':
        // Forward to content script if needed
        handleExtractCart(sender, sendResponse);
        break;

      case 'BUILD_PROMPT':
        // Build LLM prompt with provided data
        handleBuildPrompt(message.payload, sendResponse);
        break;

      case 'CALL_OPENAI':
        // Make OpenAI API call (optional - can be done in content script)
        handleOpenAICall(message.payload, sendResponse);
        break;

      case 'CREATE_BANNER':
        // Forward banner creation to content script
        handleCreateBanner(sender, message.payload, sendResponse);
        break;

      default:
        sendResponse({
          success: false,
          error: 'Unknown message type'
        });
    }

    // Return true to indicate async response
    return true;
  }
);

// Handler functions
async function handleExtractCart(
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ExtensionMessageResponse) => void
) {
  try {
    if (!sender.tab?.id) {
      throw new Error('No tab ID available');
    }

    // Execute cart extraction in content script
    const results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: () => {
        // This will be replaced by actual content script function
        return [];
      }
    });

    sendResponse({
      success: true,
      data: results[0]?.result || []
    });
  } catch (error) {
    console.error('Error extracting cart:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

function handleBuildPrompt(
  payload: any,
  sendResponse: (response: ExtensionMessageResponse) => void
) {
  // Prompt building is typically done in popup or content script
  // This is a placeholder for future use
  sendResponse({
    success: true,
    data: 'Prompt building handled in popup'
  });
}

async function handleOpenAICall(
  payload: any,
  sendResponse: (response: ExtensionMessageResponse) => void
) {
  // OpenAI calls can be handled here or in content script
  // For now, we'll handle it in content script to keep API key in content context
  sendResponse({
    success: true,
    data: 'OpenAI calls handled in content script'
  });
}

async function handleCreateBanner(
  sender: chrome.runtime.MessageSender,
  payload: any,
  sendResponse: (response: ExtensionMessageResponse) => void
) {
  try {
    if (!sender.tab?.id) {
      throw new Error('No tab ID available');
    }

    // Forward to content script to create banner
    await chrome.tabs.sendMessage(sender.tab.id, {
      type: 'CREATE_BANNER',
      payload
    });

    sendResponse({ success: true });
  } catch (error) {
    console.error('Error creating banner:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Storage change listener (optional - for debugging)
chrome.storage.onChanged.addListener((changes, namespace) => {
  console.log('Storage changed in', namespace);
  for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
    console.log(
      `  ${key}:`,
      oldValue === undefined ? '[not set]' : '[hidden]',
      '→',
      newValue === undefined ? '[deleted]' : '[hidden]'
    );
  }
});

// Tab update listener (optional - for future features)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Could trigger automatic recommendation here
    console.log('Tab loaded:', tab.url);
  }
});

// Export for testing (if needed)
export {};
