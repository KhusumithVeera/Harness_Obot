import React, { useState, useRef } from 'react';
import {
  Key,
  Lock,
  Check,
  X,
  AlertCircle,
  ExternalLink,
  Shield,
  HelpCircle,
  Download,
  Upload,
  Trash2,
  Moon,
  Sun,
  Laptop,
  CheckCircle2,
  Globe,
  Loader2,
  DollarSign,
  AlertTriangle,
} from 'lucide-react';
import {
  AppSettings,
  Conversation,
  DocumentMeta,
  ModelInfo,
  ModelPrice,
  ProviderId,
  ProviderKeyConfig,
} from '../types';
import { cleanApiKey, resetKeys, exportDataAsJson, validateAndParseImport } from '../services/storage';
import { getProvider } from '../services/providers';
import { getTavilyUsage, isTavilyNearLimit } from '../services/webSearch';

interface SettingsViewProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => Promise<void>;
  models: ModelInfo[];
  conversations: Conversation[];
  documents: DocumentMeta[];
  onImportConversations: (conversations: Conversation[]) => void;
  onClearAllData: () => void;
  onShowToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  activePassphrase: string | null;
  onSetPassphrase: (pass: string | null) => void;
}

type KeyTestStatus = 'idle' | 'testing' | 'valid' | 'invalid';

interface ProviderHelp {
  title: string;
  url: string;
  steps: string[];
  note?: string;
}

const PROVIDER_HELP_GUIDES: Record<string, ProviderHelp> = {
  openai: {
    title: 'OpenAI API Key',
    url: 'https://platform.openai.com/api-keys',
    steps: [
      'Log into platform.openai.com',
      'Go to API keys in dashboard',
      'Click "Create new secret key"',
      'Copy the key and paste it here',
    ],
    note: 'Note: The OpenAI API requires prepaid credit ($5+ balance), otherwise calls fail with a quota error.',
  },
  anthropic: {
    title: 'Anthropic Claude API Key',
    url: 'https://console.anthropic.com/settings/keys',
    steps: [
      'Log into console.anthropic.com',
      'Go to API Keys in the left menu',
      'Click "Create Key"',
      'Copy the key and paste it here',
    ],
  },
  google: {
    title: 'Google Gemini API Key',
    url: 'https://aistudio.google.com/app/apikey',
    steps: [
      'Visit aistudio.google.com',
      'Click "Get API key"',
      'Click "Create API key in new project"',
      'Copy your generated key',
    ],
    note: 'Free tier keys are available with generous limits.',
  },
  xai: {
    title: 'xAI Grok API Key',
    url: 'https://console.x.ai',
    steps: [
      'Log into console.x.ai',
      'Navigate to API Keys',
      'Generate a new API key',
      'Copy and paste it here',
    ],
  },
  tavily: {
    title: 'Tavily Search API Key',
    url: 'https://app.tavily.com',
    steps: [
      'Sign up at app.tavily.com (free, no credit card required)',
      'Open the API Keys tab',
      'Click "Create API key"',
      'Copy your free key',
    ],
    note: 'Free tier grants 1,000 basic searches per month.',
  },
};

export function SettingsView({
  settings,
  onSaveSettings,
  models,
  conversations,
  documents,
  onImportConversations,
  onClearAllData,
  onShowToast,
  activePassphrase,
  onSetPassphrase,
}: SettingsViewProps) {
  const [localKeys, setLocalKeys] = useState<ProviderKeyConfig>({ ...settings.keys });
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [testStatus, setTestStatus] = useState<Record<string, { status: KeyTestStatus; msg?: string }>>({});
  const [helpModalProvider, setHelpModalProvider] = useState<string | null>(null);
  const [confirmClearKeys, setConfirmClearKeys] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [showPassphrasePrompt, setShowPassphrasePrompt] = useState(false);
  const [priceTable, setPriceTable] = useState<Record<string, ModelPrice>>({ ...settings.modelPrices });
  const [newModelPriceId, setNewModelPriceId] = useState('');

  const importFileRef = useRef<HTMLInputElement>(null);

  const tavilyMonthlyCount = getTavilyUsage();
  const tavilyNearLimit = isTavilyNearLimit();

  // Test individual provider key
  const handleTestKey = async (providerId: ProviderId | 'tavily') => {
    const rawVal = localKeys[providerId];
    const cleaned = cleanApiKey(rawVal);
    if (!cleaned) {
      setTestStatus((prev) => ({
        ...prev,
        [providerId]: { status: 'invalid', msg: 'Key is empty' },
      }));
      return;
    }

    setTestStatus((prev) => ({
      ...prev,
      [providerId]: { status: 'testing' },
    }));

    try {
      if (providerId === 'tavily') {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cleaned}`,
          },
          body: JSON.stringify({ query: 'test', max_results: 1 }),
        });
        if (!res.ok) throw new Error('Invalid key or quota exceeded');
        setTestStatus((prev) => ({
          ...prev,
          [providerId]: { status: 'valid', msg: 'Connected' },
        }));
      } else {
        const provider = getProvider(providerId);
        const fetchedModels = await provider.listModels(cleaned);
        setTestStatus((prev) => ({
          ...prev,
          [providerId]: {
            status: 'valid',
            msg: `Connected (${fetchedModels.length} models)`,
          },
        }));
      }

      // Auto-save the valid key
      const updatedKeys = { ...localKeys, [providerId]: cleaned };
      setLocalKeys(updatedKeys);
      await onSaveSettings({ ...settings, keys: updatedKeys });
      onShowToast(`Key for ${providerId} verified & saved!`, 'success');
    } catch (err: any) {
      setTestStatus((prev) => ({
        ...prev,
        [providerId]: {
          status: 'invalid',
          msg: err.message || 'Verification failed',
        },
      }));
      onShowToast(`Failed to verify ${providerId} key: ${err.message}`, 'error');
    }
  };

  const handleKeyChange = (providerId: keyof ProviderKeyConfig, val: string) => {
    const cleaned = cleanApiKey(val);
    const updated = { ...localKeys, [providerId]: cleaned };
    setLocalKeys(updated);
    // Clear status
    setTestStatus((prev) => ({ ...prev, [providerId]: { status: 'idle' as KeyTestStatus } }));
  };

  const handleSaveAllKeys = async () => {
    const cleanedKeys: ProviderKeyConfig = {};
    for (const [k, v] of Object.entries(localKeys)) {
      if (v) cleanedKeys[k as keyof ProviderKeyConfig] = cleanApiKey(v);
    }
    await onSaveSettings({
      ...settings,
      keys: cleanedKeys,
      modelPrices: priceTable,
    });
    onShowToast('Settings saved successfully', 'success');
  };

  // Toggle Passphrase Encryption
  const handleToggleEncryption = () => {
    if (settings.encryptKeys) {
      // Disabling encryption
      onSetPassphrase(null);
      onSaveSettings({ ...settings, encryptKeys: false });
      onShowToast('Passphrase encryption disabled; keys stored locally unencrypted.', 'info');
    } else {
      setShowPassphrasePrompt(true);
    }
  };

  const handleConfirmPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphraseInput.trim()) return;
    onSetPassphrase(passphraseInput.trim());
    setShowPassphrasePrompt(false);
    await onSaveSettings({ ...settings, encryptKeys: true, keys: localKeys });
    setPassphraseInput('');
    onShowToast('Passphrase encryption enabled! Keys encrypted.', 'success');
  };

  // Data Actions
  const handleExportJson = () => {
    const jsonStr = exportDataAsJson(conversations, documents);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `harness-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast('Backup exported.', 'success');
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const { conversations: importedConvs, error } = validateAndParseImport(text);
      if (error) {
        onShowToast(`Import failed: ${error}`, 'error');
        return;
      }
      onImportConversations(importedConvs);
      onShowToast(`Successfully imported ${importedConvs.length} chats!`, 'success');
    } catch (err: any) {
      onShowToast(`Failed to read file: ${err.message}`, 'error');
    }

    if (importFileRef.current) importFileRef.current.value = '';
  };

  const handleClearKeys = async () => {
    resetKeys();
    setLocalKeys({});
    await onSaveSettings({ ...settings, keys: {} });
    setConfirmClearKeys(false);
    onShowToast('All saved API keys have been removed.', 'info');
  };

  const handleDeleteAllLocalData = () => {
    onClearAllData();
    setConfirmDeleteAll(false);
    setLocalKeys({});
  };

  const keyProviders: { id: ProviderId; label: string; placeholder: string }[] = [
    { id: 'openai', label: 'OpenAI', placeholder: 'sk-proj-…' },
    { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-…' },
    { id: 'google', label: 'Google Gemini', placeholder: 'AIzaSy…' },
    { id: 'xai', label: 'xAI Grok', placeholder: 'xai-…' },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-[#FAFAFA] dark:bg-[#0B0F19] p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Settings & Keys
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Manage your personal AI provider keys, security vault, and app preferences.
          </p>
        </div>

        {/* Exact Privacy Card per Section 2b */}
        <div className="p-4 rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/30 text-xs text-indigo-950 dark:text-indigo-200 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold">
              <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Privacy & Storage Notice</span>
            </div>
            {/* Local Vault badge */}
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                settings.encryptKeys
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700'
              }`}
            >
              {settings.encryptKeys
                ? 'Keys encrypted'
                : 'Keys stored locally (unencrypted)'}
            </span>
          </div>
          <p className="leading-relaxed font-sans text-[11px] text-gray-700 dark:text-gray-300">
            Your keys are saved in this browser only. They are sent to the AI provider you choose. If your browser blocks a direct call, the request passes through this app's server just to get there; the server does not store or log anything.
          </p>
        </div>

        {/* 1. API Keys Section */}
        <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] shadow-xs space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
              Model Provider Keys
            </h3>
            <button
              type="button"
              onClick={handleSaveAllKeys}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
            >
              Save keys
            </button>
          </div>

          <div className="space-y-4">
            {keyProviders.map((prov) => {
              const test = testStatus[prov.id];
              const isVisible = !!showKey[prov.id];
              return (
                <div key={prov.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {prov.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => setHelpModalProvider(prov.id)}
                      className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <HelpCircle className="w-3 h-3" />
                      <span>How to get this key</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={isVisible ? 'text' : 'password'}
                        value={localKeys[prov.id] || ''}
                        onChange={(e) => handleKeyChange(prov.id, e.target.value)}
                        placeholder={prov.placeholder}
                        className="w-full pl-3 pr-14 py-2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-gray-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowKey((prev) => ({ ...prev, [prov.id]: !prev[prov.id] }))
                        }
                        className="absolute right-2 top-2 text-[10px] text-gray-400 hover:text-gray-600 px-1 py-0.5 cursor-pointer"
                      >
                        {isVisible ? 'Hide' : 'Show'}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleTestKey(prov.id)}
                      disabled={test?.status === 'testing' || !localKeys[prov.id]}
                      className="px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 disabled:opacity-40 rounded-xl text-xs font-medium transition cursor-pointer shrink-0"
                    >
                      {test?.status === 'testing' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        'Test'
                      )}
                    </button>
                  </div>

                  {/* Status Badge */}
                  {test && test.status !== 'idle' && (
                    <div className="flex items-center gap-1.5 text-[11px] pt-0.5">
                      {test.status === 'valid' ? (
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                          <Check className="w-3.5 h-3.5" />
                          <span>✓ {test.msg || 'Connected'}</span>
                        </span>
                      ) : test.status === 'invalid' ? (
                        <span className="text-red-600 dark:text-red-400 flex items-center gap-1 font-medium">
                          <X className="w-3.5 h-3.5" />
                          <span>✕ {test.msg || 'Invalid key'}</span>
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Tavily Key Row */}
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-white">
                  <Globe className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Tavily Search (Free Web Search)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHelpModalProvider('tavily')}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <HelpCircle className="w-3 h-3" />
                  <span>Get a free key</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKey.tavily ? 'text' : 'password'}
                    value={localKeys.tavily || ''}
                    onChange={(e) => handleKeyChange('tavily', e.target.value)}
                    placeholder="tvly-…"
                    className="w-full pl-3 pr-14 py-2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono text-gray-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowKey((prev) => ({ ...prev, tavily: !prev.tavily }))
                    }
                    className="absolute right-2 top-2 text-[10px] text-gray-400 hover:text-gray-600 px-1 py-0.5 cursor-pointer"
                  >
                    {showKey.tavily ? 'Hide' : 'Show'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleTestKey('tavily')}
                  disabled={testStatus.tavily?.status === 'testing' || !localKeys.tavily}
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 disabled:opacity-40 rounded-xl text-xs font-medium transition cursor-pointer shrink-0"
                >
                  {testStatus.tavily?.status === 'testing' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    'Test'
                  )}
                </button>
              </div>

              {/* Monthly Tavily Usage Counter + Notes */}
              <div className="text-[11px] space-y-1 pt-1">
                <div className="flex items-center justify-between">
                  <span
                    className={`font-medium ${
                      tavilyNearLimit ? 'text-amber-600' : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {tavilyMonthlyCount} / 1,000 used this month (local estimate)
                  </span>
                  <span className="text-[10px] text-gray-400">Resets on the 1st</span>
                </div>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Keep "pay-as-you-go" turned OFF in your Tavily dashboard so you can never be charged.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Passphrase Encryption */}
        <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                Passphrase Vault Encryption
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Encrypt keys in browser storage with AES-GCM (PBKDF2). Passphrase is never stored.
              </p>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.encryptKeys}
                onChange={handleToggleEncryption}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
            </label>
          </div>

          {showPassphrasePrompt && (
            <form onSubmit={handleConfirmPassphrase} className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-3">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Choose a Passphrase to Encrypt Your Keys
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={passphraseInput}
                  onChange={(e) => setPassphraseInput(e.target.value)}
                  placeholder="Enter strong passphrase…"
                  className="flex-1 px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none text-gray-900 dark:text-white"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!passphraseInput.trim()}
                  className="px-4 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold hover:bg-indigo-700 cursor-pointer"
                >
                  Encrypt now
                </button>
              </div>
            </form>
          )}
        </div>

        {/* 3. Preferences */}
        <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] shadow-xs space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
            Preferences
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Theme */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                Theme
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['light', 'dark', 'system'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onSaveSettings({ ...settings, theme: t })}
                    className={`py-1.5 px-2 rounded-xl text-xs font-medium capitalize border transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      settings.theme === t
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {t === 'light' && <Sun className="w-3.5 h-3.5" />}
                    {t === 'dark' && <Moon className="w-3.5 h-3.5" />}
                    {t === 'system' && <Laptop className="w-3.5 h-3.5" />}
                    <span>{t}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Default model */}
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                Default Model
              </label>
              <select
                value={settings.defaultModelId}
                onChange={(e) => onSaveSettings({ ...settings, defaultModelId: e.target.value })}
                className="w-full px-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none text-gray-900 dark:text-white"
              >
                <option value="">(Use first available)</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 4. Model Price Table for Cost Estimates */}
        <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-emerald-500" />
                <span>Model Price Table (USD per 1M Tokens)</span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Used to estimate cost in the drawer. Leave blank to show token counts only.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onSaveSettings({ ...settings, modelPrices: priceTable });
                onShowToast('Price table updated!', 'success');
              }}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
            >
              Save prices
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-2 border border-gray-100 dark:border-gray-800 rounded-xl p-2 bg-gray-50/50 dark:bg-gray-850">
            {Object.entries(priceTable).map(([modelId, price]) => (
              <div
                key={modelId}
                className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs"
              >
                <span className="font-mono text-gray-900 dark:text-white flex-1 truncate">
                  {modelId}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400">In: $</span>
                  <input
                    type="number"
                    step="0.01"
                    value={price.inputPerMillion}
                    onChange={(e) =>
                      setPriceTable((prev) => ({
                        ...prev,
                        [modelId]: {
                          ...prev[modelId],
                          inputPerMillion: parseFloat(e.target.value) || 0,
                        },
                      }))
                    }
                    className="w-16 px-1.5 py-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded font-mono"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400">Out: $</span>
                  <input
                    type="number"
                    step="0.01"
                    value={price.outputPerMillion}
                    onChange={(e) =>
                      setPriceTable((prev) => ({
                        ...prev,
                        [modelId]: {
                          ...prev[modelId],
                          outputPerMillion: parseFloat(e.target.value) || 0,
                        },
                      }))
                    }
                    className="w-16 px-1.5 py-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...priceTable };
                    delete next[modelId];
                    setPriceTable(next);
                  }}
                  className="p-1 text-gray-400 hover:text-red-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add model row */}
          <div className="flex gap-2 pt-1">
            <input
              type="text"
              placeholder="Add model ID (e.g. gpt-4o-mini)"
              value={newModelPriceId}
              onChange={(e) => setNewModelPriceId(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none text-gray-900 dark:text-white"
            />
            <button
              type="button"
              disabled={!newModelPriceId.trim()}
              onClick={() => {
                if (newModelPriceId.trim()) {
                  setPriceTable((prev) => ({
                    ...prev,
                    [newModelPriceId.trim()]: { inputPerMillion: 1.0, outputPerMillion: 3.0 },
                  }));
                  setNewModelPriceId('');
                }
              }}
              className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 text-xs font-semibold rounded-xl text-gray-800 dark:text-gray-200 cursor-pointer"
            >
              Add model
            </button>
          </div>
        </div>

        {/* 5. Data Actions (Export, Import, Clear keys, Delete all) */}
        <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] shadow-xs space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
            Local Data & Backups
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleExportJson}
              className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between text-xs font-medium text-gray-800 dark:text-gray-200 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Export conversations (JSON)</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between text-xs font-medium text-gray-800 dark:text-gray-200 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Import conversations (JSON)</span>
              </div>
              <input
                type="file"
                ref={importFileRef}
                onChange={handleImportFile}
                accept=".json"
                className="hidden"
              />
            </button>

            <button
              type="button"
              onClick={() => setConfirmClearKeys(true)}
              className="p-3 rounded-xl border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-between text-xs font-medium text-red-600 dark:text-red-400 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                <span>Clear all saved keys</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setConfirmDeleteAll(true)}
              className="p-3 rounded-xl border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-between text-xs font-medium text-red-600 dark:text-red-400 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                <span>Delete all local data</span>
              </div>
            </button>
          </div>
        </div>

        {/* Confirmation Modal: Clear Keys */}
        {confirmClearKeys && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
              <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                Clear all API keys?
              </h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                This will remove all saved API keys and Gmail credentials from this browser. Your chat history will remain untouched.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmClearKeys(false)}
                  className="px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleClearKeys}
                  className="px-3 py-1.5 text-xs rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 cursor-pointer"
                >
                  Clear keys
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Modal: Delete All Local Data */}
        {confirmDeleteAll && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
              <h4 className="text-sm font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                <span>Delete all local data?</span>
              </h4>
              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                This will irreversibly delete all conversations, knowledge documents, chunks, API keys, and settings stored in this browser.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAll(false)}
                  className="px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAllLocalData}
                  className="px-3 py-1.5 text-xs rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 cursor-pointer"
                >
                  Delete everything
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Provider Help Modal ("How to get this key") */}
        {helpModalProvider && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                  {PROVIDER_HELP_GUIDES[helpModalProvider]?.title || 'API Key Guide'}
                </h4>
                <button
                  type="button"
                  onClick={() => setHelpModalProvider(null)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <ol className="list-decimal list-inside space-y-1.5 text-xs text-gray-700 dark:text-gray-300">
                {PROVIDER_HELP_GUIDES[helpModalProvider]?.steps.map((st, i) => (
                  <li key={i}>{st}</li>
                ))}
              </ol>

              {PROVIDER_HELP_GUIDES[helpModalProvider]?.note && (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-[11px] leading-relaxed">
                  {PROVIDER_HELP_GUIDES[helpModalProvider]?.note}
                </div>
              )}

              <div className="pt-2 flex items-center justify-between">
                <a
                  href={PROVIDER_HELP_GUIDES[helpModalProvider]?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-semibold"
                >
                  <span>Open provider console</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                <button
                  type="button"
                  onClick={() => setHelpModalProvider(null)}
                  className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-xl font-medium cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
