import React from 'react';

interface LoadingStateProps {
  message?: string;
  variant?: 'spinner' | 'skeleton';
}

/**
 * Loading state component with spinner or skeleton UI
 */
const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading...',
  variant = 'spinner',
}) => {
  if (variant === 'skeleton') {
    return (
      <div className="animate-fade-in p-4">
        {/* Skeleton for recommendation card */}
        <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200">
          {/* Title skeleton */}
          <div className="h-6 bg-gray-200 rounded w-3/4 mb-4 animate-pulse"></div>

          {/* Content skeleton */}
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded w-full animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6 animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded w-4/6 animate-pulse"></div>
          </div>

          {/* Rewards skeleton */}
          <div className="mt-4 space-y-2">
            <div className="h-3 bg-gray-200 rounded w-2/3 animate-pulse"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2 animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 animate-fade-in">
      {/* Spinner */}
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-4 border-gray-200"></div>
        <div className="absolute top-0 left-0 w-12 h-12 rounded-full border-4 border-primary-500 border-t-transparent animate-spin"></div>
      </div>

      {/* Message */}
      <p className="mt-4 text-sm text-gray-600 font-medium">{message}</p>

      {/* Optional sub-message */}
      <p className="mt-1 text-xs text-gray-400">This may take a few seconds</p>
    </div>
  );
};

export default LoadingState;
