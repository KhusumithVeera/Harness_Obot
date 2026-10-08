import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import {
  Send,
  Square,
  Copy,
  Check,
  RotateCcw,
  BookOpen,
  Globe,
  Paperclip,
  X,
  AlertCircle,
  AlertTriangle,
  Key,
  ExternalLink,
  ChevronDown,
  Layers,
  FileText,
  WifiOff,
  Coins,
  Mail,
  Search as SearchIcon,
  Plus as PlusIcon,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  ChatMessage,
  Conversation,
  DocumentMeta,
  ModelInfo,
  ModelPrice,
  ProviderId,
  SourceCitation,
} from '../types';
import { getProvider, detectProviderFromModel } from '../services/providers';
import { buildRetrievalQuery, BM25Index } from '../services/ragEngine';
import { loadChunksForDocs } from '../services/storage';
import {
  searchTavily,
  getTavilyUsage,
  isTavilyQuotaReached,
  isTavilyNearLimit,
  buildSearchQuery,
} from '../services/webSearch';
import { processImageFile, ProcessedImage } from '../services/imageUtils';
import {
  listGmailMessages,
  getGmailMessage,
  GmailMessageSummary,
} from '../services/gmailApi';
import { GoogleSignInButton } from './GoogleSignInButton';

interface ChatViewProps {
  conversation: Conversation | null;
  onUpdateConversation: (updated: Conversation) => void;
  currentModelId: string;
  models: ModelInfo[];
  apiKeys: Record<string, string | undefined>;
  documents: DocumentMeta[];
  modelPrices: Record<string, ModelPrice>;
  storageBanner: string | null;
  isOnline: boolean;
  onOpenSettings: () => void;
  onOpenSourcesDrawer: (sources: SourceCitation[]) => void;
  onOpenCostDrawer: () => void;
  onShowToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  googleUser: User | null;
  googleToken: string | null;
  onGoogleSignIn: () => void;
}

export function ChatView({
  conversation,
  onUpdateConversation,
  currentModelId,
  models,
  apiKeys,
  documents,
  modelPrices,
  storageBanner,
  isOnline,
  onOpenSettings,
  onOpenSourcesDrawer,
  onOpenCostDrawer,
  onShowToast,
  googleUser,
  googleToken,
  onGoogleSignIn,
}: ChatViewProps) {
  const [inputText, setInputText] = useState('');
  const [inputImages, setInputImages] = useState<ProcessedImage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [knowledgeMenuOpen, setKnowledgeMenuOpen] = useState(false);
  const [tavilyPopoverOpen, setTavilyPopoverOpen] = useState(false);
  const [gmailMenuOpen, setGmailMenuOpen] = useState(false);
  const [gmailSearchQuery, setGmailSearchQuery] = useState('');
  const [gmailMessages, setGmailMessages] = useState<GmailMessageSummary[]>([]);
  const [isLoadingGmail, setIsLoadingGmail] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmLongPaste, setConfirmLongPaste] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(120);
  const userHasScrolledUpRef = useRef(false);

  // ResizeObserver on composer to sync message list bottom padding
  useEffect(() => {
    if (!composerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setComposerHeight(entry.contentRect.height);
      }
    });
    observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, []);

  // Track user scroll position
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 80;
    userHasScrolledUpRef.current = !isAtBottom;
  };

  const scrollToBottom = (smooth = true) => {
    if (userHasScrolledUpRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    scrollToBottom(false);
  }, [conversation?.id, conversation?.messages.length]);

  const hasAnyKey = Object.values(apiKeys).some((k) => !!k?.trim());
  const currentProvider = detectProviderFromModel(currentModelId);
  const hasKeyForCurrentModel = !!apiKeys[currentProvider]?.trim();

  // Knowledge selection for active conversation
  const selectedDocIds = conversation?.knowledgeIds || [];
  const knowledgeMode = conversation?.knowledgeMode || 'retrieval';
  const isWebSearchOn = conversation?.webSearch ?? false;
  const isGmailSearchOn = conversation?.gmailSearch ?? false;

  const toggleDocSelection = (docId: string) => {
    if (!conversation) return;
    const next = selectedDocIds.includes(docId)
      ? selectedDocIds.filter((id) => id !== docId)
      : [...selectedDocIds, docId];
    onUpdateConversation({ ...conversation, knowledgeIds: next });
  };

  const setKnowledgeMode = (mode: 'retrieval' | 'full') => {
    if (!conversation) return;
    onUpdateConversation({ ...conversation, knowledgeMode: mode });
  };

  const toggleWebSearch = () => {
    if (!conversation) return;
    if (!apiKeys.tavily?.trim()) {
      setTavilyPopoverOpen(true);
      return;
    }
    if (isTavilyQuotaReached()) {
      onShowToast('Free monthly limit reached. Resets on the 1st.', 'warning');
      return;
    }
    onUpdateConversation({ ...conversation, webSearch: !isWebSearchOn });
  };

  const toggleGmailSearch = () => {
    if (!conversation) return;
    if (!googleUser) {
      setGmailMenuOpen(true);
      return;
    }
    onUpdateConversation({ ...conversation, gmailSearch: !isGmailSearchOn });
  };

  const fetchChatGmailMessages = async (query = '') => {
    if (!googleToken) return;
    setIsLoadingGmail(true);
    try {
      const msgs = await listGmailMessages(googleToken, query, 10);
      setGmailMessages(msgs);
    } catch (err: any) {
      console.warn('Gmail fetch error:', err);
    } finally {
      setIsLoadingGmail(false);
    }
  };

  useEffect(() => {
    if (gmailMenuOpen && googleToken) {
      fetchChatGmailMessages(gmailSearchQuery);
    }
  }, [gmailMenuOpen, googleToken]);

  const handleAttachEmailToChat = async (msgSummary: GmailMessageSummary) => {
    if (!googleToken) return;
    try {
      const full = await getGmailMessage(googleToken, msgSummary.id);
      const emailBlock = `\n\n--- [Attached Email: ${full.subject}] ---\nFrom: ${full.from}\nDate: ${new Date(full.date).toLocaleDateString()}\n\n${full.text}\n-----------------------------------\n\n`;
      setInputText((prev) => prev ? `${prev}${emailBlock}` : `Regarding this email:\n${emailBlock}`);
      setGmailMenuOpen(false);
      onShowToast(`Attached email: "${full.subject}" to chat context`, 'success');
    } catch (err: any) {
      onShowToast(`Failed to attach email: ${err.message}`, 'error');
    }
  };

  // Image upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const f of files) {
      try {
        const processed = await processImageFile(f);
        setInputImages((prev) => [...prev, processed]);
      } catch (err: any) {
        onShowToast(err.message || 'Failed to attach image.', 'error');
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Check total character count for long conversation warning
  const totalConvoChars = (conversation?.messages || []).reduce(
    (acc, m) => acc + (m.content?.length || 0),
    0
  );
  const isLongConvo = totalConvoChars / 4 > 100000;

  // Handle Stop
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsStreaming(false);
    setStatusMessage(null);
  };

  // Core send message handler
  const handleSend = async (overrideContent?: string, retryMessageId?: string) => {
    const textToSend = (overrideContent ?? inputText).trim();
    if (!textToSend && inputImages.length === 0) return;
    if (!conversation) return;
    if (isStreaming) return;

    if (!isOnline) {
      onShowToast("You're offline. Check your internet connection.", 'error');
      return;
    }

    if (!hasKeyForCurrentModel) {
      onShowToast(`Add an API key for ${currentProvider} in Settings.`, 'warning');
      return;
    }

    // Check long paste confirmation
    if (!overrideContent && textToSend.length > 200000 && !confirmLongPaste) {
      setConfirmLongPaste(textToSend);
      return;
    }

    // Check knowledge doc requirements
    if (selectedDocIds.length > 0) {
      const readyDocs = documents.filter(
        (d) => selectedDocIds.includes(d.id) && d.status === 'ready'
      );
      if (readyDocs.length === 0) {
        onShowToast('Selected documents are not ready yet.', 'warning');
        return;
      }
    }

    // Prepare messages
    let updatedMessages = [...conversation.messages];
    let userMsg: ChatMessage;

    if (retryMessageId) {
      // Find the user message before this retry assistant message
      const idx = updatedMessages.findIndex((m) => m.id === retryMessageId);
      if (idx > 0 && updatedMessages[idx - 1].role === 'user') {
        userMsg = updatedMessages[idx - 1];
        // Remove the failed assistant message
        updatedMessages = updatedMessages.slice(0, idx);
      } else {
        return;
      }
    } else {
      userMsg = {
        id: `msg_${Date.now()}_u`,
        role: 'user',
        content: textToSend,
        images: inputImages.length > 0 ? [...inputImages] : undefined,
        createdAt: Date.now(),
      };
      updatedMessages.push(userMsg);
      setInputText('');
      setInputImages([]);
      setConfirmLongPaste(null);
    }

    // Auto title if first user message
    let newTitle = conversation.title;
    if (conversation.messages.length === 0 && !conversation.title) {
      newTitle = textToSend.slice(0, 40) || 'New conversation';
    }

    const assistantMsgId = `msg_${Date.now()}_a`;
    const initialAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      modelId: currentModelId,
      provider: currentProvider,
      createdAt: Date.now(),
    };

    updatedMessages.push(initialAssistantMsg);

    onUpdateConversation({
      ...conversation,
      title: newTitle,
      messages: updatedMessages,
      updatedAt: Date.now(),
    });

    userHasScrolledUpRef.current = false;
    setIsStreaming(true);
    setStatusMessage(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const collectedSources: SourceCitation[] = [];
      let sourcesSection = '';
      let systemPrompt =
        'You are a helpful, accurate assistant. Be concise unless asked otherwise. If you are given sources, answer only from them and cite as [1], [2]. If the sources don\'t contain the answer, say so plainly.';

      // 1. RAG Context injection
      if (selectedDocIds.length > 0) {
        setStatusMessage('Retrieving document knowledge…');
        const chunks = await loadChunksForDocs(selectedDocIds);

        if (knowledgeMode === 'full') {
          const totalFullChars = chunks.reduce((acc, c) => acc + c.text.length, 0);
          const estTokens = totalFullChars / 4;
          if (estTokens > 150000) {
            throw new Error('This document is too large for full mode. Use Retrieval.');
          }

          let docNum = 1;
          const docParts: string[] = [];
          for (const c of chunks) {
            const docName = documents.find((d) => d.id === c.docId)?.name || 'Document';
            docParts.push(`[${docNum++}] (${docName}${c.page ? `, p.${c.page}` : ''}) ${c.text}`);
            collectedSources.push({
              type: 'doc',
              title: docName,
              docId: c.docId,
              page: c.page,
              snippet: c.text.substring(0, 200),
            });
          }
          sourcesSection += docParts.join('\n\n') + '\n\n';
        } else {
          // BM25 Retrieval
          const prevUserMsg = conversation.messages
            .filter((m) => m.role === 'user')
            .slice(-2, -1)[0]?.content;
          const query = buildRetrievalQuery(userMsg.content, prevUserMsg);
          const bm25 = new BM25Index(chunks);
          const topHits = bm25.search(query, 6);

          let hitNum = 1;
          const hitParts: string[] = [];
          for (const hit of topHits) {
            const docName = documents.find((d) => d.id === hit.chunk.docId)?.name || 'Document';
            hitParts.push(
              `[${hitNum++}] (${docName}${hit.chunk.page ? `, p.${hit.chunk.page}` : ''}) ${hit.chunk.text}`
            );
            collectedSources.push({
              type: 'doc',
              title: docName,
              docId: hit.chunk.docId,
              page: hit.chunk.page,
              snippet: hit.chunk.text.substring(0, 200),
            });
          }
          sourcesSection += hitParts.join('\n\n') + '\n\n';
        }
      }

      // 2. Web search injection
      if (isWebSearchOn && apiKeys.tavily?.trim()) {
        setStatusMessage('Searching the web…');
        try {
          const prevUserMsg = conversation.messages
            .filter((m) => m.role === 'user')
            .slice(-2, -1)[0]?.content;
          const webQuery = buildSearchQuery(userMsg.content, prevUserMsg);
          const webRes = await searchTavily(webQuery, apiKeys.tavily.trim());

          if (webRes.sources.length > 0) {
            collectedSources.push(...webRes.sources);
            sourcesSection += webRes.searchContext + '\n\n';
          }
        } catch (wErr: any) {
          onShowToast(wErr.message || 'Web search failed, answering without it', 'warning');
        }
      }

      // 3. Gmail search injection (ground answers in personal emails)
      if (conversation.gmailSearch && googleToken) {
        setStatusMessage('Searching personal Gmail…');
        try {
          const prevUserMsg = conversation.messages
            .filter((m) => m.role === 'user')
            .slice(-2, -1)[0]?.content;
          const emailQuery = buildSearchQuery(userMsg.content, prevUserMsg);
          const matchedEmails = await listGmailMessages(googleToken, emailQuery, 3);

          for (const em of matchedEmails) {
            try {
              const fullEm = await getGmailMessage(googleToken, em.id);
              const snippetText = fullEm.snippet || fullEm.text.substring(0, 200);
              const sourceIdx = collectedSources.length + 1;
              collectedSources.push({
                type: 'email',
                title: fullEm.subject || 'Gmail thread',
                snippet: `${fullEm.from}: ${snippetText}`,
              });
              sourcesSection += `[${sourceIdx}] (Gmail: "${fullEm.subject}" from ${fullEm.from}) ${fullEm.text.substring(0, 450)}\n\n`;
            } catch {}
          }
        } catch (gErr: any) {
          onShowToast(`Gmail search warning: ${gErr.message}`, 'warning');
        }
      }

      // Build synthesized messages array for provider
      const messagesForProvider: ChatMessage[] = [];
      const historyExceptLast = updatedMessages.slice(0, -2);
      messagesForProvider.push(...historyExceptLast);

      // Final user message formatted with SOURCES
      let formattedLastUserContent = userMsg.content;
      if (sourcesSection.trim()) {
        formattedLastUserContent = `SOURCES:\n${sourcesSection}\n\nQUESTION: ${userMsg.content}`;
      }

      messagesForProvider.push({
        ...userMsg,
        content: formattedLastUserContent,
      });

      setStatusMessage(null);

      const provider = getProvider(currentProvider);
      const key = apiKeys[currentProvider]?.trim() || '';

      const streamGen = provider.streamChat({
        key,
        model: currentModelId,
        system: systemPrompt,
        messages: messagesForProvider,
        signal: abortController.signal,
        useGeminiSearch: isWebSearchOn && currentProvider === 'google',
      });

      let streamedText = '';
      let streamUsage: any = undefined;

      for await (const chunk of streamGen) {
        if (chunk.text) {
          streamedText += chunk.text;
        }
        if (chunk.usage) {
          streamUsage = chunk.usage;
        }
        if (chunk.sources) {
          collectedSources.push(...chunk.sources);
        }

        // Live update message state
        const currentMsgs = [...updatedMessages];
        const lastIdx = currentMsgs.length - 1;
        if (lastIdx >= 0) {
          currentMsgs[lastIdx] = {
            ...currentMsgs[lastIdx],
            content: streamedText,
            sources: collectedSources.length > 0 ? collectedSources : undefined,
            usage: streamUsage,
          };
          onUpdateConversation({
            ...conversation,
            messages: currentMsgs,
          });
        }
      }

      // Stream completed successfully
      const finalMsgs = [...updatedMessages];
      finalMsgs[finalMsgs.length - 1] = {
        ...finalMsgs[finalMsgs.length - 1],
        content: streamedText,
        sources: collectedSources.length > 0 ? collectedSources : undefined,
        usage: streamUsage,
        status: 'complete',
      };

      onUpdateConversation({
        ...conversation,
        messages: finalMsgs,
        updatedAt: Date.now(),
      });
    } catch (err: any) {
      if (abortController.signal.aborted) {
        // Stopped cleanly by user
        const finalMsgs = [...updatedMessages];
        const target = finalMsgs[finalMsgs.length - 1];
        if (target) {
          target.status = 'stopped';
        }
        onUpdateConversation({ ...conversation, messages: finalMsgs });
        return;
      }

      // Handle image rejection retry text-only
      if (err.isImageRejection && userMsg.images && userMsg.images.length > 0) {
        onShowToast("This model doesn't support images; sent text only.", 'info');
        // Strip images and retry once
        const strippedUser = { ...userMsg, images: undefined };
        const cleanedMsgs = updatedMessages.slice(0, -2);
        cleanedMsgs.push(strippedUser);
        onUpdateConversation({ ...conversation, messages: cleanedMsgs });
        handleSend(userMsg.content);
        return;
      }

      const isInterrupted = err.message && err.message.includes('interrupted');
      const errDisplay = isInterrupted
        ? 'Stopped (connection interrupted)'
        : err.message || 'An error occurred during response generation.';

      const finalMsgs = [...updatedMessages];
      const target = finalMsgs[finalMsgs.length - 1];
      if (target) {
        target.status = 'error';
        target.errorMessage = errDisplay;
      }
      onUpdateConversation({ ...conversation, messages: finalMsgs });
    } finally {
      setIsStreaming(false);
      setStatusMessage(null);
      abortControllerRef.current = null;
    }
  };

  // Copy message
  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Regenerate last assistant message
  const handleRegenerate = () => {
    if (!conversation || isStreaming) return;
    const msgs = conversation.messages;
    if (msgs.length < 2) return;
    const last = msgs[msgs.length - 1];
    if (last.role === 'assistant') {
      const prevUser = msgs[msgs.length - 2];
      if (prevUser.role === 'user') {
        handleSend(prevUser.content, last.id);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAFAFA] dark:bg-[#0B0F19] relative overflow-hidden">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-500 text-white text-xs px-4 py-2 flex items-center justify-center gap-2 font-medium z-10 shrink-0">
          <WifiOff className="w-4 h-4" />
          <span>You're offline. Check your internet connection.</span>
        </div>
      )}

      {/* Persistent Storage Warning Banner */}
      {storageBanner && (
        <div className="bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border-b border-amber-200 dark:border-amber-800 text-xs px-4 py-2 flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>{storageBanner}</span>
          </div>
        </div>
      )}

      {/* Model Key Missing Warning Banner */}
      {!hasKeyForCurrentModel && hasAnyKey && (
        <div className="bg-indigo-50 dark:bg-indigo-950/60 border-b border-indigo-200 dark:border-indigo-800 text-xs px-4 py-2 flex items-center justify-between text-indigo-900 dark:text-indigo-200 z-10 shrink-0">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Add a {currentProvider} key or choose another model</span>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-xs font-semibold underline hover:opacity-80 cursor-pointer"
          >
            Settings
          </button>
        </div>
      )}

      {/* Messages Scroll View */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-6 max-w-4xl w-full mx-auto"
        style={{ paddingBottom: `${composerHeight + 24}px` }}
      >
        {/* Onboarding Card if no keys */}
        {!hasAnyKey ? (
          <div className="my-12 p-8 max-w-md mx-auto bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xl text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
              <Key className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Welcome to Harness
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              Harness is a private, multi-model AI workspace. Paste your own API keys for OpenAI, Anthropic, Google Gemini, or xAI Grok to begin.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={onOpenSettings}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs transition cursor-pointer"
              >
                Add an API key to start chatting
              </button>
            </div>
          </div>
        ) : conversation?.messages.length === 0 ? (
          /* Empty chat welcome state */
          <div className="my-16 text-center space-y-3 max-w-sm mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto font-bold text-xl">
              H
            </div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              How can I assist you today?
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              Pick any model, connect documents for verified answers, or enable real-time web search.
            </p>
          </div>
        ) : (
          /* Message List */
          conversation?.messages.map((msg, index) => {
            const isAssistant = msg.role === 'assistant';
            const isLastMessage = index === conversation.messages.length - 1;

            return (
              <div
                key={msg.id || index}
                className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}
              >
                <div
                  className={`max-w-[90%] sm:max-w-[85%] rounded-2xl p-4 shadow-xs text-sm leading-relaxed ${
                    isAssistant
                      ? 'bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100'
                      : 'bg-indigo-600 text-white rounded-br-xs'
                  }`}
                >
                  {/* Images attached */}
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {msg.images.map((img, imgIdx) => (
                        <img
                          key={imgIdx}
                          src={`data:${img.mime};base64,${img.base64}`}
                          alt="Attachment"
                          className="max-h-48 rounded-xl object-cover border border-white/20 shadow-xs"
                        />
                      ))}
                    </div>
                  )}

                  {/* Message content formatted in sanitized Markdown */}
                  {isAssistant ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none break-words font-sans">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSanitize]}
                        components={{
                          code({ node, inline, className, children, ...props }: any) {
                            return inline ? (
                              <code
                                className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs text-indigo-600 dark:text-indigo-400"
                                {...props}
                              >
                                {children}
                              </code>
                            ) : (
                              <pre className="p-3 rounded-xl bg-gray-900 text-gray-100 font-mono text-xs overflow-x-auto my-2 border border-gray-800">
                                <code {...props}>{children}</code>
                              </pre>
                            );
                          },
                        }}
                      >
                        {msg.content || (isStreaming && isLastMessage ? '…' : '')}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap font-sans">{msg.content}</div>
                  )}

                  {/* Inline Error Banner */}
                  {msg.status === 'error' && (
                    <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>{msg.errorMessage || 'Response generation failed.'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSend(undefined, msg.id)}
                        className="px-2.5 py-1 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition cursor-pointer shrink-0"
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Stopped banner */}
                  {msg.status === 'stopped' && (
                    <div className="mt-2 text-[11px] text-gray-400 italic">
                      Response stopped
                    </div>
                  )}
                </div>

                {/* Assistant Message Actions & Chips */}
                {isAssistant && (
                  <div className="flex flex-wrap items-center gap-2 mt-2 px-1 text-xs text-gray-500">
                    {/* Copy Button */}
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="inline-flex items-center gap-1 p-1 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer rounded"
                      title="Copy response"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-[11px] text-emerald-600">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span className="text-[11px]">Copy</span>
                        </>
                      )}
                    </button>

                    {/* Regenerate Button */}
                    {isLastMessage && !isStreaming && (
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        className="inline-flex items-center gap-1 p-1 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer rounded"
                        title="Regenerate response"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="text-[11px]">Regenerate</span>
                      </button>
                    )}

                    {/* Sources Chip */}
                    {msg.sources && msg.sources.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onOpenSourcesDrawer(msg.sources || [])}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-[11px] font-medium hover:bg-indigo-100 cursor-pointer"
                      >
                        <BookOpen className="w-3 h-3" />
                        <span>Sources ({msg.sources.length})</span>
                      </button>
                    )}

                    {/* Usage / Cost Chip */}
                    {msg.usage && (
                      <button
                        type="button"
                        onClick={onOpenCostDrawer}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[11px] font-mono hover:bg-gray-200 cursor-pointer"
                        title="View token & cost breakdown"
                      >
                        <Coins className="w-3 h-3 text-amber-500" />
                        <span>
                          {(msg.usage.inputTokens || 0) + (msg.usage.outputTokens || 0)} toks
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Searching web / reading docs status indicator */}
        {statusMessage && (
          <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 p-2 animate-pulse">
            <Globe className="w-4 h-4 animate-spin" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Long conversation context warning chip */}
        {isLongConvo && (
          <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>Long conversation: consider starting a new chat for best accuracy.</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Very long paste confirmation dialog */}
      {confirmLongPaste && (
        <div className="absolute inset-x-4 bottom-32 z-30 max-w-lg mx-auto p-4 bg-white dark:bg-[#111827] border border-amber-300 dark:border-amber-800 rounded-2xl shadow-2xl space-y-3">
          <div className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <div className="text-xs">
              <p className="font-bold">Very large input ({confirmLongPaste.length.toLocaleString()} characters)</p>
              <p className="mt-1">
                Sending this much text may exceed model limits or consume significant tokens. Are you sure you want to proceed?
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setConfirmLongPaste(null)}
              className="px-3 py-1.5 text-xs rounded-xl border border-gray-300 dark:border-gray-700 hover:bg-gray-50 text-gray-700 dark:text-gray-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSend(confirmLongPaste)}
              className="px-3 py-1.5 text-xs rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 cursor-pointer"
            >
              Send anyway
            </button>
          </div>
        </div>
      )}

      {/* Sticky Bottom Composer */}
      <div
        ref={composerRef}
        className="absolute inset-x-0 bottom-0 bg-white/95 dark:bg-[#111827]/95 border-t border-gray-200 dark:border-gray-800 p-3 sm:p-4 backdrop-blur z-20"
      >
        <div className="max-w-4xl mx-auto space-y-2">
          {/* Image preview badges */}
          {inputImages.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-1">
              {inputImages.map((img, idx) => (
                <div
                  key={idx}
                  className="relative group w-14 h-14 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700"
                >
                  <img
                    src={`data:${img.mime};base64,${img.base64}`}
                    alt="Upload thumbnail"
                    className="w-full h-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setInputImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Composer Input Area */}
          <div className="relative flex flex-col bg-gray-50 dark:bg-gray-850 border border-gray-200 dark:border-gray-700 rounded-2xl p-2.5 focus-within:ring-2 focus-within:ring-indigo-500/50 transition shadow-xs">
            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                !hasAnyKey
                  ? 'Add an API key to start chatting'
                  : !hasKeyForCurrentModel
                  ? `Add a ${currentProvider} key in Settings`
                  : !isOnline
                  ? "You're offline"
                  : 'Message Harness… (Shift+Enter for new line)'
              }
              disabled={!hasAnyKey || !hasKeyForCurrentModel || !isOnline}
              className="w-full bg-transparent resize-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none max-h-36 min-h-[28px]"
            />

            {/* Bottom Toolbar: Knowledge Pill, Web Search Toggle, Image upload, Send/Stop */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Knowledge Pill Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setKnowledgeMenuOpen(!knowledgeMenuOpen)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition cursor-pointer ${
                      selectedDocIds.length > 0
                        ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>
                      Knowledge{' '}
                      {selectedDocIds.length > 0 ? `(${selectedDocIds.length})` : ''}
                    </span>
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </button>

                  {knowledgeMenuOpen && (
                    <div className="absolute left-0 bottom-full mb-2 w-72 bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 rounded-2xl p-3 shadow-2xl z-50 text-xs space-y-3 animate-in fade-in zoom-in-95">
                      <div className="font-semibold text-gray-900 dark:text-white flex items-center justify-between">
                        <span>Documents</span>
                        <span className="text-[10px] text-gray-400 font-normal">
                          {documents.length} uploaded
                        </span>
                      </div>

                      {documents.length === 0 ? (
                        <div className="text-gray-400 py-2">
                          No documents uploaded yet. Go to the Knowledge tab to add files.
                        </div>
                      ) : (
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {documents.map((d) => (
                            <label
                              key={d.id}
                              className="flex items-center gap-2 p-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedDocIds.includes(d.id)}
                                onChange={() => toggleDocSelection(d.id)}
                                className="rounded text-indigo-600"
                              />
                              <span className="truncate flex-1">{d.name}</span>
                              <span className="text-[10px] text-gray-400 uppercase">
                                {d.type}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}

                      {/* Mode selector */}
                      <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                        <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                          Mode
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => setKnowledgeMode('retrieval')}
                            className={`py-1 px-2 rounded-lg border text-center transition cursor-pointer ${
                              knowledgeMode === 'retrieval'
                                ? 'bg-indigo-600 text-white border-indigo-600 font-medium'
                                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                            }`}
                          >
                            Retrieval
                          </button>
                          <button
                            type="button"
                            onClick={() => setKnowledgeMode('full')}
                            className={`py-1 px-2 rounded-lg border text-center transition cursor-pointer ${
                              knowledgeMode === 'full'
                                ? 'bg-indigo-600 text-white border-indigo-600 font-medium'
                                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                            }`}
                          >
                            Full doc
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Web Search Toggle */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={toggleWebSearch}
                    disabled={isTavilyQuotaReached()}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition cursor-pointer ${
                      isWebSearchOn
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                        : isTavilyQuotaReached()
                        ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800 border-gray-200 text-gray-400'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50'
                    }`}
                    title={
                      isTavilyQuotaReached()
                        ? 'Free monthly limit reached. Resets on the 1st.'
                        : 'Search the web for real-time answers'
                    }
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Web search</span>
                  </button>

                  {/* Web search toggle ends */}
                </div>

                {/* Gmail Integration Toggle & Email Attach */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setGmailMenuOpen(!gmailMenuOpen)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition cursor-pointer ${
                      conversation?.gmailSearch
                        ? 'bg-rose-50 dark:bg-rose-950/60 border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50'
                    }`}
                    title={
                      googleUser
                        ? `Personal Gmail: ${googleUser.email}`
                        : 'Connect personal Gmail to chat'
                    }
                  >
                    <Mail className="w-3.5 h-3.5 text-rose-500" />
                    <span>Gmail</span>
                    {googleUser && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    )}
                  </button>

                  {/* Gmail Popover */}
                  {gmailMenuOpen && (
                    <div className="absolute left-0 bottom-full mb-2 w-80 sm:w-96 bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 rounded-2xl p-3.5 shadow-2xl z-50 text-xs space-y-3 animate-in fade-in zoom-in-95">
                      {googleUser ? (
                        <>
                          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                              <div>
                                <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1">
                                  <span>Personal Gmail</span>
                                </div>
                                <div className="text-[11px] text-gray-500 font-mono">
                                  {googleUser.email}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setGmailMenuOpen(false)}
                              className="p-1 text-gray-400 hover:text-gray-600 rounded"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Toggle: Ground answers in Gmail */}
                          <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700/60">
                            <div>
                              <div className="font-semibold text-gray-900 dark:text-white text-[11px]">
                                Ground answers with Gmail
                              </div>
                              <div className="text-[10px] text-gray-500">
                                Search personal emails when answering questions
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={toggleGmailSearch}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                                conversation?.gmailSearch
                                  ? 'bg-rose-600 text-white'
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              {conversation?.gmailSearch ? 'Active' : 'Off'}
                            </button>
                          </div>

                          {/* Attach email to prompt */}
                          <div className="space-y-2 pt-1">
                            <div className="font-semibold text-gray-700 dark:text-gray-300 text-[11px] flex items-center justify-between">
                              <span>Attach Email to Context</span>
                              <span className="text-[10px] text-gray-400">Click to insert</span>
                            </div>

                            <div className="relative">
                              <SearchIcon className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
                              <input
                                type="text"
                                placeholder="Search inbox messages…"
                                value={gmailSearchQuery}
                                onChange={(e) => setGmailSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && fetchChatGmailMessages(gmailSearchQuery)}
                                className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>

                            <div className="max-h-48 overflow-y-auto space-y-1 pt-1">
                              {isLoadingGmail ? (
                                <div className="text-center py-4 text-gray-400 text-[11px]">
                                  Loading messages…
                                </div>
                              ) : gmailMessages.length === 0 ? (
                                <div className="text-center py-4 text-gray-400 text-[11px]">
                                  No messages found.
                                </div>
                              ) : (
                                gmailMessages.map((msg) => (
                                  <div
                                    key={msg.id}
                                    onClick={() => handleAttachEmailToChat(msg)}
                                    className="p-2 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-indigo-50/20 dark:hover:bg-indigo-950/20 transition cursor-pointer text-left"
                                  >
                                    <div className="font-semibold text-gray-900 dark:text-gray-100 text-[11px] truncate">
                                      {msg.subject || '(No subject)'}
                                    </div>
                                    <div className="text-[10px] text-gray-500 truncate">
                                      {msg.from}
                                    </div>
                                    {msg.snippet && (
                                      <div className="text-[10px] text-gray-400 truncate mt-0.5">
                                        {msg.snippet}
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        /* Not signed in prompt */
                        <div className="text-center space-y-3 p-1">
                          <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                            <Mail className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-bold text-gray-900 dark:text-white text-xs">
                              Connect Personal Gmail
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                              Connect your personal Gmail account to search emails or bring email context directly into your chat.
                            </p>
                          </div>
                          <div className="pt-1">
                            <GoogleSignInButton
                              onClick={() => {
                                setGmailMenuOpen(false);
                                onGoogleSignIn();
                              }}
                              size="sm"
                              label="Sign in with Google"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Image upload button */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition cursor-pointer"
                  title="Attach image (PNG, JPEG, WebP, GIF max 5MB)"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              </div>

              {/* Action: Send or Stop */}
              <div>
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSend()}
                    disabled={
                      (!inputText.trim() && inputImages.length === 0) ||
                      !hasAnyKey ||
                      !hasKeyForCurrentModel ||
                      !isOnline
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
                  >
                    <span>Send</span>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
