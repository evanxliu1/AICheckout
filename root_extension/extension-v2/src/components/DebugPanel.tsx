// Debug panel component to display recommendation reasoning and logs
import React, { useState, useEffect } from 'react';
import { getRecommendationLogs, clearRecommendationLogs, exportLogsAsJSON } from '../utils/logging';
import type { RecommendationLog } from '../types';

interface DebugPanelProps {
  currentRecommendation?: {
    card: string;
    category: string;
    reasoning?: string;
  };
}

export const DebugPanel: React.FC<DebugPanelProps> = ({ currentRecommendation }) => {
  const [logs, setLogs] = useState<RecommendationLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<RecommendationLog | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    const allLogs = await getRecommendationLogs();
    setLogs(allLogs);
  };

  const handleClearLogs = async () => {
    if (confirm('Clear all recommendation logs?')) {
      await clearRecommendationLogs();
      setLogs([]);
      setSelectedLog(null);
    }
  };

  const handleExportLogs = async () => {
    const json = await exportLogsAsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recommendation-logs-${Date.now()}.json`;
    a.click();
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      {/* Current Recommendation Reasoning */}
      {currentRecommendation?.reasoning && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-blue-900">🔍 Why {currentRecommendation.card}?</h3>
          </div>
          <p className="text-xs text-blue-800 whitespace-pre-wrap">{currentRecommendation.reasoning}</p>
        </div>
      )}

      {/* Debug Panel Toggle */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-sm text-gray-600 hover:text-gray-900 font-medium flex items-center gap-1"
        >
          <span>{isExpanded ? '▼' : '▶'}</span>
          Debug Logs ({logs.length})
        </button>
        {logs.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={handleExportLogs}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Export
            </button>
            <button
              onClick={handleClearLogs}
              className="text-xs text-red-600 hover:text-red-800"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Expanded Debug View */}
      {isExpanded && (
        <div className="space-y-2">
          {logs.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No logs yet. Get a recommendation to start logging.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-2">
              {logs.map((log, index) => (
                <div
                  key={index}
                  className="p-2 bg-gray-50 rounded border border-gray-200 cursor-pointer hover:bg-gray-100"
                  onClick={() => setSelectedLog(selectedLog === log ? null : log)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="text-xs font-medium text-gray-900">{log.recommendation.card}</p>
                      <p className="text-xs text-gray-600">{log.site} • {log.recommendation.category}</p>
                      <p className="text-xs text-gray-500">{formatDate(log.timestamp)}</p>
                    </div>
                    <span className="text-xs text-gray-400">{selectedLog === log ? '▼' : '▶'}</span>
                  </div>

                  {/* Expanded Log Details */}
                  {selectedLog === log && (
                    <div className="mt-2 pt-2 border-t border-gray-300 space-y-2">
                      {/* Cart Items */}
                      <div>
                        <p className="text-xs font-semibold text-gray-700">Cart Items ({log.cartItems.length}):</p>
                        <ul className="text-xs text-gray-600 list-disc list-inside">
                          {log.cartItems.slice(0, 5).map((item, i) => (
                            <li key={i}>{item.name}</li>
                          ))}
                          {log.cartItems.length > 5 && (
                            <li className="text-gray-500 italic">...and {log.cartItems.length - 5} more</li>
                          )}
                        </ul>
                      </div>

                      {/* Reasoning */}
                      {log.recommendation.reasoning && (
                        <div>
                          <p className="text-xs font-semibold text-gray-700">Reasoning:</p>
                          <p className="text-xs text-gray-600 whitespace-pre-wrap">{log.recommendation.reasoning}</p>
                        </div>
                      )}

                      {/* All Cards Considered */}
                      <div>
                        <p className="text-xs font-semibold text-gray-700">Cards Considered:</p>
                        <ul className="text-xs text-gray-600 space-y-1">
                          {log.allCards.map((card, i) => (
                            <li key={i} className={card.name === log.recommendation.card ? 'font-bold text-blue-700' : ''}>
                              {card.name}: {Object.entries(card.rewards).map(([cat, val]) => `${cat}=${val}`).join(', ')}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Prompt & Response */}
                      <details className="text-xs">
                        <summary className="cursor-pointer font-semibold text-gray-700">Show Prompt & Response</summary>
                        <div className="mt-1 p-2 bg-white rounded border border-gray-300">
                          <p className="font-semibold text-gray-700 mb-1">Prompt:</p>
                          <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-x-auto">{log.prompt}</pre>
                          <p className="font-semibold text-gray-700 mb-1 mt-2">Raw Response:</p>
                          <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-x-auto">{log.rawResponse}</pre>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
