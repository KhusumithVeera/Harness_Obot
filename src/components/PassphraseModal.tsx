import React, { useState } from 'react';
import { Lock, KeyRound, AlertCircle, Trash2 } from 'lucide-react';
import { unlockKeys, resetKeys } from '../services/storage';
import { ProviderKeyConfig } from '../types';

interface PassphraseModalProps {
  onUnlocked: (keys: ProviderKeyConfig) => void;
  onReset: () => void;
}

export function PassphraseModal({ onUnlocked, onReset }: PassphraseModalProps) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirmReset, setShowConfirmReset] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;

    setLoading(true);
    setError(null);
    try {
      const keys = await unlockKeys(passphrase);
      onUnlocked(keys);
    } catch {
      setError('Wrong passphrase');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = () => {
    resetKeys();
    setShowConfirmReset(false);
    onReset();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#111827] border border-gray-200 dark:border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-4">
          <Lock className="w-6 h-6" />
        </div>

        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
          Vault Locked
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Your API keys are encrypted with a passphrase. Enter your passphrase to unlock them for this session.
        </p>

        {error && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1">
              Passphrase
            </label>
            <div className="relative">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setError(null);
                }}
                placeholder="Enter passphrase…"
                autoFocus
                className="w-full pl-3 pr-10 py-2.5 bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white"
              />
              <KeyRound className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setShowConfirmReset(true)}
              className="text-xs text-red-600 dark:text-red-400 hover:underline cursor-pointer"
            >
              Reset keys
            </button>

            <button
              type="submit"
              disabled={loading || !passphrase}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium text-sm rounded-xl transition cursor-pointer shadow-sm"
            >
              {loading ? 'Unlocking…' : 'Unlock keys'}
            </button>
          </div>
        </form>

        {showConfirmReset && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 text-sm">
            <p className="text-red-600 dark:text-red-400 font-semibold mb-2 flex items-center gap-1.5">
              <Trash2 className="w-4 h-4" /> Reset all encrypted keys?
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
              This will remove the saved encrypted keys from this browser. You can enter new keys afterward in Settings.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmReset(false)}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium cursor-pointer"
              >
                Confirm reset
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
