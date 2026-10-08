import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AppSettings,
  Conversation,
  DocumentMeta,
  ModelInfo,
  ProviderId,
  SourceCitation,
} from './types';
import {
  loadSettings,
  saveSettings,
  loadConversations,
  saveConversations,
  loadDocuments,
  saveDocuments,
  hasEncryptedKeys,
  getActivePassphrase,
  setActivePassphrase,
  getStorageBanner,
  deleteAllLocalData,
} from './services/storage';
import { PROVIDERS, detectProviderFromModel } from './services/providers';
import { Header } from './components/Header';
import { Sidebar, MainNavTab } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { KnowledgeView } from './components/KnowledgeView';
import { EmailView } from './components/EmailView';
import { SettingsView } from './components/SettingsView';
import { RightDrawer } from './components/RightDrawer';
import { PassphraseModal } from './components/PassphraseModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/Toast';
import { User } from 'firebase/auth';
import {
  subscribeToAuth,
  googleSignIn,
  googleLogout,
} from './services/googleAuth';

// Default starter model list so dropdown is immediately populated even before network call
const STARTER_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', supportsImages: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', supportsImages: true },
  { id: 'o3-mini', name: 'o3 Mini', provider: 'openai', supportsImages: false },
  { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'anthropic', supportsImages: true },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic', supportsImages: true },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'anthropic', supportsImages: true },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', supportsImages: true },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', supportsImages: true },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'google', supportsImages: true },
  { id: 'grok-2-1212', name: 'Grok 2', provider: 'xai', supportsImages: false },
  { id: 'grok-2-vision-1212', name: 'Grok 2 Vision', provider: 'xai', supportsImages: true },
];

function HarnessApp() {
  const { toast } = useToast();

  // App state
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<MainNavTab>('chat');
  const [currentModelId, setCurrentModelId] = useState<string>('gpt-4o');

  // Network & System
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [storageBanner, setStorageBanner] = useState<string | null>(getStorageBanner());

  // Models
  const [models, setModels] = useState<ModelInfo[]>(() => {
    try {
      const cached = localStorage.getItem('harness:cached_models');
      return cached ? JSON.parse(cached) : STARTER_MODELS;
    } catch {
      return STARTER_MODELS;
    }
  });
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);

  // Layout UI
  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [rightDrawerTab, setRightDrawerTab] = useState<'sources' | 'cost'>('sources');
  const [activeSources, setActiveSources] = useState<SourceCitation[]>([]);

  // Passphrase modal
  const [needsUnlock, setNeedsUnlock] = useState(() => hasEncryptedKeys() && !getActivePassphrase());

  // Google OAuth state (for personal Gmail)
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((user, token) => {
      setGoogleUser(user);
      setGoogleToken(token);
    });
    return unsubscribe;
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      const res = await googleSignIn();
      if (res?.user) {
        toast(`Connected personal Gmail: ${res.user.email}`, 'success');
      }
    } catch (err: any) {
      toast(`Google Sign-in failed: ${err.message}`, 'error');
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await googleLogout();
      toast('Disconnected from Google account', 'info');
    } catch (err: any) {
      toast(`Sign out failed: ${err.message}`, 'error');
    }
  };

  // Listen to network status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Theme management (Light / Dark / System)
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (theme: 'light' | 'dark' | 'system') => {
      let isDark = false;
      if (theme === 'system') {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      } else {
        isDark = theme === 'dark';
      }
      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    applyTheme(settings.theme);

    if (settings.theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = (e: MediaQueryListEvent) => {
        if (e.matches) root.classList.add('dark');
        else root.classList.remove('dark');
      };
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
  }, [settings.theme]);

  // Load conversations & documents on initial mount
  useEffect(() => {
    const initData = async () => {
      const loadedConvs = await loadConversations();
      setConversations(loadedConvs);
      if (loadedConvs.length > 0) {
        setActiveConversationId(loadedConvs[0].id);
      }

      const loadedDocs = await loadDocuments();
      setDocuments(loadedDocs);

      // Restore last used model or fallback
      const storedLastModel = localStorage.getItem('harness:last_model');
      if (storedLastModel) {
        setCurrentModelId(storedLastModel);
      } else if (settings.defaultModelId) {
        setCurrentModelId(settings.defaultModelId);
      }
    };
    initData();
  }, []);

  // Save active conversation selection
  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [conversations, activeConversationId]);

  // Update sources for right drawer whenever active conversation changes
  useEffect(() => {
    if (!activeConversation) {
      setActiveSources([]);
      return;
    }
    const allSources: SourceCitation[] = [];
    for (const msg of activeConversation.messages) {
      if (msg.sources) {
        allSources.push(...msg.sources);
      }
    }
    setActiveSources(allSources);
  }, [activeConversation]);

  // Providers with configured keys
  const availableProviders = useMemo(() => {
    const set = new Set<ProviderId>();
    if (settings.keys.openai?.trim()) set.add('openai');
    if (settings.keys.anthropic?.trim()) set.add('anthropic');
    if (settings.keys.google?.trim()) set.add('google');
    if (settings.keys.xai?.trim()) set.add('xai');
    return set;
  }, [settings.keys]);

  // Fetch live models for configured keys
  const fetchLiveModels = useCallback(async () => {
    setIsRefreshingModels(true);
    const combinedModels: ModelInfo[] = [...STARTER_MODELS];

    const providersToFetch: ProviderId[] = ['openai', 'anthropic', 'google', 'xai'];
    for (const pId of providersToFetch) {
      const key = settings.keys[pId]?.trim();
      if (!key) continue;

      try {
        const pModels = await PROVIDERS[pId].listModels(key);
        // Remove starters for this provider and replace with live
        const others = combinedModels.filter((m) => m.provider !== pId);
        combinedModels.length = 0;
        combinedModels.push(...others, ...pModels);
      } catch (err: any) {
        console.warn(`Failed to fetch models for ${pId}:`, err);
      }
    }

    setModels(combinedModels);
    try {
      localStorage.setItem('harness:cached_models', JSON.stringify(combinedModels));
    } catch {}
    setIsRefreshingModels(false);
  }, [settings.keys]);

  // Fetch live models when keys change
  useEffect(() => {
    if (availableProviders.size > 0) {
      fetchLiveModels();
    }
  }, [availableProviders.size]);

  // Model selection handler (persists last used model and checks fallback)
  const handleSelectModel = (modelId: string) => {
    setCurrentModelId(modelId);
    try {
      localStorage.setItem('harness:last_model', modelId);
    } catch {}
  };

  // Fallback check: if selected model doesn't exist, fall back to first available
  useEffect(() => {
    if (models.length > 0 && currentModelId) {
      const exists = models.some((m) => m.id === currentModelId);
      if (!exists) {
        const fallback = models[0].id;
        setCurrentModelId(fallback);
        toast(`Model '${currentModelId}' unavailable; switched to '${fallback}'.`, 'info');
      }
    }
  }, [models]);

  // Save Settings
  const handleSaveSettings = async (updated: AppSettings) => {
    setSettings(updated);
    await saveSettings(updated);
  };

  // Conversation operations
  const handleCreateNewConversation = () => {
    const newConv: Conversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: 'New chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      knowledgeIds: [],
      knowledgeMode: 'retrieval',
      webSearch: settings.alwaysWebSearch,
    };
    const nextConvs = [newConv, ...conversations];
    setConversations(nextConvs);
    setActiveConversationId(newConv.id);
    saveConversations(nextConvs);
  };

  const handleUpdateConversation = (updated: Conversation) => {
    const next = conversations.map((c) => (c.id === updated.id ? updated : c));
    setConversations(next);
    saveConversations(next);
  };

  const handleDeleteConversation = (id: string) => {
    const next = conversations.filter((c) => c.id !== id);
    setConversations(next);
    saveConversations(next);
    if (activeConversationId === id) {
      setActiveConversationId(next[0]?.id || null);
    }
    toast('Conversation deleted', 'info');
  };

  // Knowledge operations
  const handleUpdateDocuments = (docs: DocumentMeta[]) => {
    setDocuments(docs);
    saveDocuments(docs);
  };

  const handleRemoveDocFromConversations = (docId: string) => {
    const nextConvs = conversations.map((c) => {
      if (c.knowledgeIds.includes(docId)) {
        return {
          ...c,
          knowledgeIds: c.knowledgeIds.filter((id) => id !== docId),
        };
      }
      return c;
    });
    setConversations(nextConvs);
    saveConversations(nextConvs);
  };

  // Import conversations
  const handleImportConversations = (imported: Conversation[]) => {
    const combined = [...imported, ...conversations];
    setConversations(combined);
    if (imported[0]) setActiveConversationId(imported[0].id);
    saveConversations(combined);
  };

  // Delete all local data
  const handleClearAllData = async () => {
    await deleteAllLocalData();
    setConversations([]);
    setDocuments([]);
    setActiveConversationId(null);
    setSettings(loadSettings());
    toast('All local data has been erased.', 'info');
  };

  // Ensure there is at least one active conversation when on chat tab
  useEffect(() => {
    if (currentTab === 'chat' && !activeConversationId && conversations.length === 0) {
      handleCreateNewConversation();
    }
  }, [currentTab, activeConversationId, conversations.length]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#FAFAFA] dark:bg-[#0B0F19] text-[#111827] dark:text-[#F3F4F6] font-sans antialiased">
      {/* Passphrase Unlock Prompt if keys encrypted */}
      {needsUnlock && (
        <PassphraseModal
          onUnlocked={(unlockedKeys) => {
            setSettings((prev) => ({ ...prev, keys: unlockedKeys }));
            setNeedsUnlock(false);
            toast('Keys unlocked successfully!', 'success');
          }}
          onReset={() => {
            setSettings((prev) => ({ ...prev, keys: {}, encryptKeys: false }));
            setNeedsUnlock(false);
            toast('Encrypted keys reset.', 'info');
          }}
        />
      )}

      {/* Left Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onNewConversation={handleCreateNewConversation}
        onDeleteConversation={handleDeleteConversation}
        isOpenMobile={sidebarOpenMobile}
        onCloseMobile={() => setSidebarOpenMobile(false)}
      />

      {/* Main Center Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Top Header */}
        <Header
          currentModelId={currentModelId}
          onSelectModel={handleSelectModel}
          models={models}
          availableProviders={availableProviders}
          isRefreshingModels={isRefreshingModels}
          onRefreshModels={fetchLiveModels}
          onOpenSettings={() => setCurrentTab('settings')}
          onToggleSidebar={() => setSidebarOpenMobile(!sidebarOpenMobile)}
          showSourcesDrawer={rightDrawerOpen && rightDrawerTab === 'sources'}
          onToggleSourcesDrawer={() => {
            if (rightDrawerOpen && rightDrawerTab === 'sources') {
              setRightDrawerOpen(false);
            } else {
              setRightDrawerTab('sources');
              setRightDrawerOpen(true);
            }
          }}
          showCostDrawer={rightDrawerOpen && rightDrawerTab === 'cost'}
          onToggleCostDrawer={() => {
            if (rightDrawerOpen && rightDrawerTab === 'cost') {
              setRightDrawerOpen(false);
            } else {
              setRightDrawerTab('cost');
              setRightDrawerOpen(true);
            }
          }}
          sourcesCount={activeSources.length}
          googleUser={googleUser}
          onGoogleSignIn={handleGoogleSignIn}
          onGoogleLogout={handleGoogleLogout}
        />

        {/* View Switcher based on currentTab */}
        <main className="flex-1 flex overflow-hidden relative">
          {currentTab === 'chat' && (
            <ChatView
              conversation={activeConversation}
              onUpdateConversation={handleUpdateConversation}
              currentModelId={currentModelId}
              models={models}
              apiKeys={settings.keys}
              documents={documents}
              modelPrices={settings.modelPrices}
              storageBanner={storageBanner}
              isOnline={isOnline}
              onOpenSettings={() => setCurrentTab('settings')}
              onOpenSourcesDrawer={(sources) => {
                setActiveSources(sources);
                setRightDrawerTab('sources');
                setRightDrawerOpen(true);
              }}
              onOpenCostDrawer={() => {
                setRightDrawerTab('cost');
                setRightDrawerOpen(true);
              }}
              onShowToast={toast}
              googleUser={googleUser}
              googleToken={googleToken}
              onGoogleSignIn={handleGoogleSignIn}
            />
          )}

          {currentTab === 'knowledge' && (
            <KnowledgeView
              documents={documents}
              onUpdateDocuments={handleUpdateDocuments}
              onRemoveDocFromConversations={handleRemoveDocFromConversations}
              hasGeminiKey={!!settings.keys.google?.trim()}
              onShowToast={toast}
            />
          )}

          {currentTab === 'email' && (
            <EmailView
              currentModelId={currentModelId}
              models={models}
              apiKeys={settings.keys}
              onShowToast={toast}
              onOpenSettings={() => setCurrentTab('settings')}
              googleUser={googleUser}
              googleToken={googleToken}
              onGoogleSignIn={handleGoogleSignIn}
              onGoogleLogout={handleGoogleLogout}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView
              settings={settings}
              onSaveSettings={handleSaveSettings}
              models={models}
              conversations={conversations}
              documents={documents}
              onImportConversations={handleImportConversations}
              onClearAllData={handleClearAllData}
              onShowToast={toast}
              activePassphrase={getActivePassphrase()}
              onSetPassphrase={setActivePassphrase}
            />
          )}
        </main>
      </div>

      {/* Right Drawer (Sources & Cost) */}
      <RightDrawer
        isOpen={rightDrawerOpen}
        onClose={() => setRightDrawerOpen(false)}
        activeTab={rightDrawerTab}
        onChangeTab={setRightDrawerTab}
        conversation={activeConversation || undefined}
        activeSources={activeSources}
        modelPrices={settings.modelPrices}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <HarnessApp />
      </ToastProvider>
    </ErrorBoundary>
  );
}
