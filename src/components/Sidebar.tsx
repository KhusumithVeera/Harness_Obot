import React, { useState } from 'react';
import {
  MessageSquare,
  BookOpen,
  Mail,
  Settings,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Conversation } from '../types';

export type MainNavTab = 'chat' | 'knowledge' | 'email' | 'settings';

interface SidebarProps {
  currentTab: MainNavTab;
  onSelectTab: (tab: MainNavTab) => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  currentTab,
  onSelectTab,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  isOpenMobile,
  onCloseMobile,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredConversations = conversations.filter((c) =>
    (c.title || 'Untitled chat').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const navItems: { tab: MainNavTab; label: string; icon: React.ReactNode }[] = [
    { tab: 'chat', label: 'Chat', icon: <MessageSquare className="w-4 h-4" /> },
    { tab: 'knowledge', label: 'Knowledge', icon: <BookOpen className="w-4 h-4" /> },
    { tab: 'email', label: 'Email', icon: <Mail className="w-4 h-4" /> },
    { tab: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/50 z-30 md:hidden backdrop-blur-xs transition-opacity"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 bg-white dark:bg-[#111827] border-r border-gray-200 dark:border-gray-800 flex flex-col transition-transform duration-200 ease-in-out md:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-xs">
              H
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-gray-900 dark:text-white text-base tracking-tight">
                  Harness
                </span>
                {/* 4 Provider dots */}
                <div className="flex items-center gap-1 ml-1" title="OpenAI, Anthropic, Google, xAI">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10A37F]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D97757]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4285F4]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#111111] dark:bg-gray-300" />
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            className="md:hidden p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action: New Chat */}
        <div className="p-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              onSelectTab('chat');
              onNewConversation();
              onCloseMobile();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New chat</span>
          </button>
        </div>

        {/* Search Chats */}
        <div className="px-3 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search chats…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-800 rounded-xl text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          <div className="px-2 py-1 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            Conversations
          </div>
          {filteredConversations.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-gray-400">
              {searchQuery ? 'No matching chats' : 'No chats yet'}
            </div>
          ) : (
            filteredConversations.map((c) => {
              const isActive = currentTab === 'chat' && activeConversationId === c.id;
              return (
                <div
                  key={c.id}
                  className={`group flex items-center justify-between rounded-xl px-2.5 py-2 text-xs transition cursor-pointer ${
                    isActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                  onClick={() => {
                    onSelectTab('chat');
                    onSelectConversation(c.id);
                    onCloseMobile();
                  }}
                >
                  <span className="truncate flex-1 pr-2">
                    {c.title || 'Untitled chat'}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteConversation(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition"
                    title="Delete chat"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Navigation Tabs (Single Navigation: Chat / Knowledge / Email / Settings) */}
        <div className="p-2 border-t border-gray-100 dark:border-gray-800 space-y-0.5 shrink-0 bg-gray-50/50 dark:bg-gray-900/30">
          {navItems.map((item) => {
            const isTabActive = currentTab === item.tab;
            return (
              <button
                key={item.tab}
                type="button"
                onClick={() => {
                  onSelectTab(item.tab);
                  onCloseMobile();
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                  isTabActive
                    ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-xs border border-gray-200/80 dark:border-gray-700'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/70 dark:hover:bg-gray-800/50'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}
