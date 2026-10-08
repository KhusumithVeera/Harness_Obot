import React, { useState, useRef, useEffect } from 'react';
import {
  Menu,
  ChevronDown,
  RefreshCw,
  Search,
  BookOpen,
  Coins,
  AlertTriangle,
  ExternalLink,
  Plus,
  Mail,
  LogOut,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { ModelInfo, ProviderId } from '../types';
import { detectProviderFromModel } from '../services/providers';

interface HeaderProps {
  currentModelId: string;
  onSelectModel: (modelId: string) => void;
  models: ModelInfo[];
  availableProviders: Set<ProviderId>;
  isRefreshingModels: boolean;
  onRefreshModels: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  showSourcesDrawer: boolean;
  onToggleSourcesDrawer: () => void;
  showCostDrawer: boolean;
  onToggleCostDrawer: () => void;
  sourcesCount: number;
  googleUser: User | null;
  onGoogleSignIn: () => void;
  onGoogleLogout: () => void;
}

const PROVIDER_COLORS: Record<ProviderId, string> = {
  openai: '#10A37F',
  anthropic: '#D97757',
  google: '#4285F4',
  xai: '#111111',
};

const PROVIDER_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  xai: 'xAI Grok',
};

export function Header({
  currentModelId,
  onSelectModel,
  models,
  availableProviders,
  isRefreshingModels,
  onRefreshModels,
  onOpenSettings,
  onToggleSidebar,
  showSourcesDrawer,
  onToggleSourcesDrawer,
  showCostDrawer,
  onToggleCostDrawer,
  sourcesCount,
  googleUser,
  onGoogleSignIn,
  onGoogleLogout,
}: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualModelInput, setManualModelInput] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentProvider = detectProviderFromModel(currentModelId);
  const isCurrentGemini = currentProvider === 'google';

  const currentModelName =
    models.find((m) => m.id === currentModelId)?.name ||
    currentModelId ||
    'Select a model';

  const filteredModels = models.filter((m) => {
    const q = searchQuery.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  });

  const providersList: ProviderId[] = ['openai', 'anthropic', 'google', 'xai'];

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualModelInput.trim()) {
      onSelectModel(manualModelInput.trim());
      setManualModelInput('');
      setShowManualInput(false);
      setDropdownOpen(false);
    }
  };

  return (
    <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white/90 dark:bg-[#111827]/90 backdrop-blur px-4 flex items-center justify-between z-20 shrink-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="md:hidden p-2 -ml-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
          title="Open sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Model Picker */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/80 hover:bg-gray-100 dark:hover:bg-gray-700/80 transition text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer shadow-xs max-w-[280px] sm:max-w-[360px]"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{
                backgroundColor: PROVIDER_COLORS[currentProvider] || '#4F46E5',
              }}
            />
            <span className="truncate">{currentModelName}</span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0 ml-1" />
          </button>

          {dropdownOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-80 sm:w-96 bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95">
              {/* Search + Refresh */}
              <div className="flex items-center gap-2 p-1.5 border-b border-gray-100 dark:border-gray-800 mb-2">
                <Search className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  type="text"
                  placeholder="Search models…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs bg-transparent focus:outline-none text-gray-900 dark:text-white"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={onRefreshModels}
                  disabled={isRefreshingModels}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 cursor-pointer"
                  title="Refresh models"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingModels ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Providers & models list */}
              <div className="max-h-72 overflow-y-auto space-y-3 p-1">
                {providersList.map((pId) => {
                  const hasKey = availableProviders.has(pId);
                  const pModels = filteredModels.filter((m) => m.provider === pId);

                  return (
                    <div key={pId} className="space-y-1">
                      <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: PROVIDER_COLORS[pId] }}
                          />
                          <span>{PROVIDER_NAMES[pId]}</span>
                        </div>
                        {!hasKey && (
                          <button
                            type="button"
                            onClick={() => {
                              setDropdownOpen(false);
                              onOpenSettings();
                            }}
                            className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer lowercase first-letter:uppercase"
                          >
                            Add key in Settings
                          </button>
                        )}
                      </div>

                      {hasKey ? (
                        pModels.length > 0 ? (
                          pModels.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => {
                                onSelectModel(model.id);
                                setDropdownOpen(false);
                              }}
                              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium text-left transition cursor-pointer ${
                                currentModelId === model.id
                                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                                  : 'hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              <span className="truncate">{model.name}</span>
                              {model.supportsImages && (
                                <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 ml-2">
                                  Vision
                                </span>
                              )}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-1.5 text-xs text-gray-400 italic">
                            No models found or list failed
                          </div>
                        )
                      ) : (
                        <div className="px-3 py-1 text-xs text-gray-400">
                          Configure key in Settings to activate
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Manual model entry button / form */}
              <div className="pt-2 mt-2 border-t border-gray-100 dark:border-gray-800">
                {showManualInput ? (
                  <form onSubmit={handleManualAdd} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. gpt-4o, claude-3-7-sonnet"
                      value={manualModelInput}
                      onChange={(e) => setManualModelInput(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={!manualModelInput.trim()}
                      className="px-2.5 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium cursor-pointer"
                    >
                      Use
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowManualInput(true)}
                    className="w-full flex items-center justify-center gap-1.5 py-1 text-xs text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Enter model ID manually
                  </button>
                )}
              </div>

              {/* Gemini free-tier info notice */}
              {isCurrentGemini && (
                <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-xl text-[11px] leading-tight text-amber-800 dark:text-amber-200">
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <span>
                      On Google's free tier, content you send may be used to improve Google's products. Avoid sensitive emails/documents with Gemini, or use another provider.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Gemini Notice Pill in Header if selected */}
        {isCurrentGemini && (
          <span className="hidden xl:inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800/50">
            <AlertTriangle className="w-3 h-3 shrink-0" /> Free tier content note
          </span>
        )}
      </div>

      {/* Right Drawer Toggles & Google Account */}
      <div className="flex items-center gap-1.5">
        {googleUser ? (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="font-medium truncate max-w-[140px]" title={googleUser.email || ''}>
              {googleUser.email}
            </span>
            <button
              type="button"
              onClick={onGoogleLogout}
              className="p-0.5 text-gray-400 hover:text-red-500 rounded cursor-pointer ml-0.5"
              title="Disconnect Google account"
            >
              <LogOut className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onGoogleSignIn}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-medium cursor-pointer transition shadow-xs"
            title="Connect your personal Gmail account"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            <span>Connect Gmail</span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleSourcesDrawer}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
            showSourcesDrawer
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          title="Toggle sources drawer"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Sources</span>
          {sourcesCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center font-bold">
              {sourcesCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleCostDrawer}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
            showCostDrawer
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          title="Toggle cost breakdown"
        >
          <Coins className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Cost</span>
        </button>
      </div>
    </header>
  );
}
