import React, { useState } from 'react';
import type { CartItem } from '../types';

interface CartItemsListProps {
  items: CartItem[];
}

/**
 * Display extracted cart items with expandable list for 6+ items
 */
const CartItemsList: React.FC<CartItemsListProps> = ({ items }) => {
  const [expanded, setExpanded] = useState(false);

  // Split items: first 5 always visible, rest expandable
  const visibleItems = expanded ? items : items.slice(0, 5);
  const hiddenCount = items.length - 5;
  const hasMore = items.length > 5;

  // Calculate total if prices are available
  const parsePrice = (price?: string): number => {
    if (!price) return 0;
    const match = price.match(/[\d,.]+/);
    if (!match) return 0;
    return parseFloat(match[0].replace(/,/g, ''));
  };

  const itemsWithPrices = items.filter((item) => item.price);
  const total = items.reduce((sum, item) => sum + parsePrice(item.price), 0);
  const hasTotal = total > 0;
  const isPartialTotal = hasTotal && itemsWithPrices.length < items.length;

  return (
    <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-primary-500"
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
          <h3 className="text-sm font-medium text-gray-500">
            Cart Items ({items.length})
          </h3>
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-2 mb-3">
        {visibleItems.map((item, index) => (
          <div
            key={index}
            className="flex items-start justify-between text-sm"
          >
            <span className="text-gray-700 flex-1 pr-2">{item.name}</span>
            {item.price && (
              <span className="text-gray-900 font-medium whitespace-nowrap">
                {item.price}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Show More/Less Button */}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-center text-sm text-primary-600 hover:text-primary-700 font-medium py-2 flex items-center justify-center gap-1 transition-colors"
        >
          {expanded ? (
            <>
              Show less
              <svg
                className="w-4 h-4 transform rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </>
          ) : (
            <>
              Show {hiddenCount} more item{hiddenCount !== 1 ? 's' : ''}
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </>
          )}
        </button>
      )}

      {/* Total */}
      {hasTotal && (
        <div className="border-t border-gray-200 pt-3 mt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              Total{isPartialTotal && ' (partial)'}
            </span>
            <span className="text-base font-bold text-primary-700">
              ${total.toFixed(2)}
            </span>
          </div>
          {isPartialTotal && (
            <p className="text-xs text-gray-400 mt-1">
              Some items missing prices
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CartItemsList;
