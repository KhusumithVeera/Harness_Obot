import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Search,
  ExternalLink,
} from 'lucide-react';
import { DocumentChunk, DocumentMeta } from '../types';
import {
  parseFileToPages,
  chunkTextPages,
  BM25Index,
  BM25ScoreResult,
} from '../services/ragEngine';
import {
  saveChunksForDoc,
  deleteChunksForDoc,
  loadChunksForDocs,
} from '../services/storage';

interface KnowledgeViewProps {
  documents: DocumentMeta[];
  onUpdateDocuments: (docs: DocumentMeta[]) => void;
  onRemoveDocFromConversations: (docId: string) => void;
  hasGeminiKey: boolean;
  onShowToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function KnowledgeView({
  documents,
  onUpdateDocuments,
  onRemoveDocFromConversations,
  hasGeminiKey,
  onShowToast,
}: KnowledgeViewProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, string>>({});
  const [testQuery, setTestQuery] = useState('');
  const [testResults, setTestResults] = useState<BM25ScoreResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    for (const file of fileArray) {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!['.pdf', '.docx', '.txt', '.md', '.csv'].includes(ext)) {
        onShowToast('Unsupported file type. Use PDF, DOCX, TXT, MD or CSV.', 'error');
        continue;
      }

      if (file.size === 0) {
        onShowToast('This file is empty.', 'error');
        continue;
      }

      if (file.size > 20 * 1024 * 1024) {
        onShowToast(`File ${file.name} exceeds 20 MB limit.`, 'error');
        continue;
      }

      // Handle duplicate name by appending (2)
      let finalName = file.name;
      const count = documents.filter((d) => d.name === finalName).length;
      if (count > 0) {
        const dotIdx = file.name.lastIndexOf('.');
        if (dotIdx > 0) {
          finalName = `${file.name.substring(0, dotIdx)} (${count + 1})${file.name.substring(dotIdx)}`;
        } else {
          finalName = `${file.name} (${count + 1})`;
        }
      }

      const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const newDoc: DocumentMeta = {
        id: docId,
        name: finalName,
        size: file.size,
        type: ext.replace('.', ''),
        charCount: 0,
        chunkCount: 0,
        createdAt: Date.now(),
        status: 'processing',
      };

      // Add as processing to list
      const updatedList = [newDoc, ...documents];
      onUpdateDocuments(updatedList);

      try {
        setUploadProgress((prev) => ({ ...prev, [docId]: 'Reading file…' }));

        const { pages, totalChars } = await parseFileToPages(file, (progressText) => {
          setUploadProgress((prev) => ({ ...prev, [docId]: progressText }));
        });

        setUploadProgress((prev) => ({ ...prev, [docId]: 'Generating chunks…' }));
        const chunks = chunkTextPages(docId, pages, 1000, 150);

        await saveChunksForDoc(docId, chunks);

        if (chunks.length > 5000) {
          onShowToast('Large document: search may be slower.', 'warning');
        }

        const completedDoc: DocumentMeta = {
          ...newDoc,
          pages: pages.length,
          charCount: totalChars,
          chunkCount: chunks.length,
          status: 'ready',
        };

        onUpdateDocuments(
          updatedList.map((d) => (d.id === docId ? completedDoc : d))
        );
        onShowToast(`Document "${finalName}" indexed successfully!`, 'success');
      } catch (err: any) {
        const failedDoc: DocumentMeta = {
          ...newDoc,
          status: 'failed',
          error: err.message || 'Parsing failed',
        };
        onUpdateDocuments(
          updatedList.map((d) => (d.id === docId ? failedDoc : d))
        );
        onShowToast(`Failed to parse "${finalName}": ${err.message}`, 'error');
      } finally {
        setUploadProgress((prev) => {
          const next = { ...prev };
          delete next[docId];
          return next;
        });
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (docId: string) => {
    await deleteChunksForDoc(docId);
    onRemoveDocFromConversations(docId);
    onUpdateDocuments(documents.filter((d) => d.id !== docId));
    onShowToast('Document deleted.', 'info');
  };

  // Test BM25 Retrieval search
  const handleTestSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testQuery.trim() || documents.length === 0) return;

    setIsSearching(true);
    try {
      const readyDocIds = documents.filter((d) => d.status === 'ready').map((d) => d.id);
      const chunks = await loadChunksForDocs(readyDocIds);
      const bm25 = new BM25Index(chunks);
      const results = bm25.search(testQuery.trim(), 6);
      setTestResults(results);
    } catch (err: any) {
      onShowToast(`Search test failed: ${err.message}`, 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#FAFAFA] dark:bg-[#0B0F19] p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Knowledge Base (RAG)
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Upload reference documents to ground model answers in verified citations. Processed entirely in your browser.
          </p>
        </div>

        {/* Gemini free tier privacy notice */}
        {hasGeminiKey && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 rounded-2xl text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold">Privacy notice regarding Google Gemini free tier</p>
              <p className="text-[11px] mt-0.5 text-amber-700 dark:text-amber-300">
                On Google's free tier, content you send may be used to improve Google's products. Avoid sensitive documents with Gemini, or switch to OpenAI or Anthropic.
              </p>
            </div>
          </div>
        )}

        {/* Drag and Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 ${
            isDragging
              ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
              : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] hover:border-indigo-400 dark:hover:border-indigo-600'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            accept=".pdf,.docx,.txt,.md,.csv"
            multiple
            className="hidden"
          />
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              Drop files here or click to upload
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Supports PDF, DOCX, TXT, MD, CSV (up to 20 MB per file)
            </p>
          </div>
        </div>

        {/* Uploaded Documents List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              Documents ({documents.length})
            </h3>
          </div>

          {documents.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-[#111827] rounded-2xl border border-gray-200 dark:border-gray-800 text-xs text-gray-400">
              No documents uploaded yet. Upload a document to start grounding chats.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {documents.map((doc) => {
                const progressMsg = uploadProgress[doc.id];
                return (
                  <div
                    key={doc.id}
                    className="p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] shadow-xs flex flex-col justify-between space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-600 dark:text-gray-300 uppercase font-mono text-[11px] font-bold shrink-0">
                          {doc.type}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-gray-900 dark:text-white truncate">
                            {doc.name}
                          </h4>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {formatFileSize(doc.size)}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition cursor-pointer"
                        title="Delete document"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Status & Metrics */}
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-800/80 flex items-center justify-between text-[11px]">
                      {doc.status === 'processing' ? (
                        <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>{progressMsg || 'Processing…'}</span>
                        </div>
                      ) : doc.status === 'failed' ? (
                        <div
                          className="flex items-center gap-1.5 text-red-600 dark:text-red-400 truncate max-w-[200px]"
                          title={doc.error}
                        >
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">Failed: {doc.error}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Ready</span>
                        </div>
                      )}

                      {doc.status === 'ready' && (
                        <div className="text-gray-400 font-mono text-[10px]">
                          {doc.chunkCount} chunks {doc.pages ? `· ${doc.pages}p` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Test Retrieval (BM25 Verification) */}
        {documents.some((d) => d.status === 'ready') && (
          <div className="p-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] shadow-xs space-y-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Test Retrieval Query
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Test how the BM25 retrieval index scores chunks across your ready documents.
              </p>
            </div>

            <form onSubmit={handleTestSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="e.g. quarterly revenue or cancellation policy…"
                  value={testQuery}
                  onChange={(e) => setTestQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 text-gray-900 dark:text-white"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !testQuery.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                {isSearching ? 'Searching…' : 'Test search'}
              </button>
            </form>

            {testResults.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <div className="text-xs font-semibold text-gray-500">
                  Top Matches ({testResults.length})
                </div>
                {testResults.map((res, idx) => {
                  const doc = documents.find((d) => d.id === res.chunk.docId);
                  return (
                    <div
                      key={idx}
                      className="p-3 bg-gray-50 dark:bg-gray-850 rounded-xl border border-gray-200/60 dark:border-gray-800 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-gray-500 text-[11px]">
                        <span className="font-semibold text-gray-800 dark:text-gray-200">
                          {doc?.name || 'Document'} {res.chunk.page ? `(p. ${res.chunk.page})` : ''}
                        </span>
                        <span className="font-mono text-indigo-600 dark:text-indigo-400">
                          Score: {res.score.toFixed(3)}
                        </span>
                      </div>
                      <p className="text-gray-600 dark:text-gray-300 font-sans leading-relaxed text-[11px]">
                        "{res.chunk.text}"
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
