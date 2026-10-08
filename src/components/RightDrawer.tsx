import React from 'react';
import { X, ExternalLink, BookOpen, Coins, HelpCircle } from 'lucide-react';
import { Conversation, ModelPrice, SourceCitation } from '../types';

interface RightDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: 'sources' | 'cost';
  onChangeTab: (tab: 'sources' | 'cost') => void;
  conversation?: Conversation;
  activeSources: SourceCitation[];
  modelPrices: Record<string, ModelPrice>;
}

export function RightDrawer({
  isOpen,
  onClose,
  activeTab,
  onChangeTab,
  conversation,
  activeSources,
  modelPrices,
}: RightDrawerProps) {
  if (!isOpen) return null;

  // Compute total tokens and costs for the conversation
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let hasPricedModel = false;

  const messagesWithUsage = conversation?.messages.filter((m) => m.usage) || [];

  for (const m of messagesWithUsage) {
    const input = m.usage?.inputTokens || 0;
    const output = m.usage?.outputTokens || 0;
    totalInputTokens += input;
    totalOutputTokens += output;

    const modelId = m.modelId || '';
    const price = modelPrices[modelId];
    if (price && (price.inputPerMillion > 0 || price.outputPerMillion > 0)) {
      hasPricedModel = true;
      totalCostUsd += (input / 1_000_000) * price.inputPerMillion;
      totalCostUsd += (output / 1_000_000) * price.outputPerMillion;
    }
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 z-30 lg:hidden backdrop-blur-xs"
      />

      <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-sm sm:w-96 bg-white dark:bg-[#111827] border-l border-gray-200 dark:border-gray-800 flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Drawer Header & Tabs */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => onChangeTab('sources')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'sources'
                  ? 'bg-white dark:bg-[#111827] text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Sources ({activeSources.length})</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTab('cost')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                activeTab === 'cost'
                  ? 'bg-white dark:bg-[#111827] text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Coins className="w-3.5 h-3.5" />
              <span>Cost</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'sources' ? (
            activeSources.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-400">
                <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p>No citations for this conversation yet.</p>
                <p className="mt-1 text-[11px]">
                  Turn on Knowledge or Web Search to ground answers.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeSources.map((s, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-850 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[10px] flex items-center justify-center font-bold">
                          {idx + 1}
                        </span>
                        <span className="truncate">{s.title}</span>
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase ${
                          s.type === 'email'
                            ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                            : 'bg-gray-200/60 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {s.type === 'email' ? 'GMAIL' : s.type}
                      </span>
                    </div>

                    {s.page && (
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        Page {s.page}
                      </div>
                    )}

                    <p className="text-gray-600 dark:text-gray-300 leading-relaxed font-sans text-[11px] bg-white dark:bg-gray-900 p-2 rounded-lg border border-gray-100 dark:border-gray-800 line-clamp-4">
                      "{s.snippet}"
                    </p>

                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline pt-1"
                      >
                        <span>Visit link</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            /* Cost Tab */
            <div className="space-y-4">
              {/* Overall Conversation Stats */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/50 space-y-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Conversation Total
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-gray-500 text-[11px]">Input Tokens</div>
                    <div className="font-semibold text-gray-900 dark:text-white font-mono text-sm">
                      {totalInputTokens.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-[11px]">Output Tokens</div>
                    <div className="font-semibold text-gray-900 dark:text-white font-mono text-sm">
                      {totalOutputTokens.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                  <div className="text-gray-500 text-[11px]">Estimated Cost</div>
                  {hasPricedModel ? (
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                      ${totalCostUsd < 0.0001 ? '<$0.0001' : totalCostUsd.toFixed(4)}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 italic">
                      Tokens only (set price in Settings)
                    </div>
                  )}
                </div>
              </div>

              {/* Message Breakdown */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Message Breakdown
                </div>
                {messagesWithUsage.length === 0 ? (
                  <div className="text-xs text-gray-400 italic py-2">
                    No assistant messages with usage reported yet.
                  </div>
                ) : (
                  messagesWithUsage.map((m, idx) => {
                    const mPrice = modelPrices[m.modelId || ''];
                    let mCost: number | null = null;
                    if (mPrice && (mPrice.inputPerMillion || mPrice.outputPerMillion)) {
                      mCost =
                        ((m.usage?.inputTokens || 0) / 1_000_000) * mPrice.inputPerMillion +
                        ((m.usage?.outputTokens || 0) / 1_000_000) * mPrice.outputPerMillion;
                    }

                    return (
                      <div
                        key={m.id || idx}
                        className="p-2.5 rounded-xl border border-gray-100 dark:border-gray-800 text-xs bg-white dark:bg-gray-850 flex items-center justify-between"
                      >
                        <div className="space-y-0.5">
                          <div className="font-medium text-gray-800 dark:text-gray-200 text-[11px] truncate max-w-[160px]">
                            {m.modelId || 'Assistant'}
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono">
                            in: {m.usage?.inputTokens || 0} / out: {m.usage?.outputTokens || 0}
                          </div>
                        </div>

                        <div className="text-right">
                          {mCost !== null ? (
                            <span className="font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">
                              ${mCost < 0.0001 ? '<$0.0001' : mCost.toFixed(4)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400">Tokens only</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Note on prices */}
              <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/40 text-[11px] text-indigo-700 dark:text-indigo-300 flex items-start gap-2">
                <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Prices are based on your custom model price table in Settings. Token usage is exact when reported by the provider.
                </span>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
