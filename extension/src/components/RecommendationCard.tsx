import React from 'react';
import type { Recommendation } from '../types';

interface RecommendationCardProps {
  recommendation: Recommendation;
}

/**
 * Display credit card recommendation with rewards breakdown
 */
const RecommendationCard: React.FC<RecommendationCardProps> = ({ recommendation }) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <svg
              className="w-5 h-5 text-primary-500"
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
            <h3 className="text-sm font-medium text-gray-500">Best Card</h3>
          </div>
          <h2 className="text-xl font-bold text-gray-900">{recommendation.card}</h2>
        </div>
      </div>

      {/* Rewards Section */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Rewards
        </h4>
        <div className="bg-gradient-to-r from-primary-50 to-blue-50 rounded-md p-3 space-y-1.5">
          {Object.entries(recommendation.rewards).map(([category, value]) => (
            <div key={category} className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 capitalize">
                {category}
              </span>
              <span className="text-sm font-bold text-primary-700">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Merchant & Category Info */}
      <div className="space-y-2 border-t border-gray-200 pt-3">
        <div className="flex items-start gap-2">
          <svg
            className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
            />
          </svg>
          <div className="flex-1">
            <p className="text-xs text-gray-500">Merchant</p>
            <p className="text-sm text-gray-900 font-medium">{recommendation.merchant}</p>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <svg
            className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
          <div className="flex-1">
            <p className="text-xs text-gray-500">Category</p>
            <p className="text-sm text-gray-900 font-medium capitalize">
              {recommendation.category}
            </p>
          </div>
        </div>
      </div>

      {/* Footer note */}
      <div className="mt-4 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-400 text-center">
          AI-powered recommendation based on your cart
        </p>
      </div>
    </div>
  );
};

export default RecommendationCard;
