import React, { useState } from 'react';
import { SHARE_PERMISSIONS, buildShareMailto, createTopicShare } from '../lib/sharing';

export default function ShareTopicModal({
  topic,
  stance,
  session,
  ownerName,
  onClose,
  onShared,
}) {
  const [permission, setPermission] = useState('view');
  const [selectedStance, setSelectedStance] = useState(stance || 'Affirmative');
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  if (!topic) return null;

  const handleShare = async (e) => {
    e.preventDefault();
    if (!session?.user?.id) return;

    try {
      setIsCreating(true);
      setError('');
      setResult(null);
      setCopied(false);

      const shareResult = await createTopicShare({
        topic,
        ownerId: session.user.id,
        stance: selectedStance,
        permission,
      });

      setResult(shareResult);
      onShared?.(shareResult);
    } catch (err) {
      console.error('Share failed:', err);
      setError(err.message || 'Could not create share invite.');
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = async () => {
    if (!result?.shareLink) return;
    try {
      await navigator.clipboard.writeText(result.shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt('Copy this invite link:', result.shareLink);
    }
  };

  const openEmail = () => {
    if (!result) return;
    const mailto = buildShareMailto({
      topicTitle: topic.title,
      ownerName,
      shareLink: result.shareLink,
      permission,
      stance: selectedStance,
    });
    window.location.href = mailto;
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200/80 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start gap-3">
          <div>
            <h3 className="text-lg font-black text-blue-950">Share topic</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Create a link for teammates. They sign up, open the link, then join this workspace.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold text-sm p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
          <p className="text-sm font-bold text-slate-800 leading-snug">{topic.title}</p>
        </div>

        {!result ? (
          <form onSubmit={handleShare} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Side to share
              </label>
              <div className="grid grid-cols-2 gap-2">
                {['Affirmative', 'Negative'].map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setSelectedStance(side)}
                    className={`p-2.5 rounded-xl border text-xs font-extrabold transition cursor-pointer ${
                      selectedStance === side
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {side === 'Affirmative' ? '👍 Affirmative' : '👎 Negative'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Permission
              </label>
              <div className="space-y-2">
                {Object.values(SHARE_PERMISSIONS).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPermission(option.id)}
                    className={`w-full text-left p-3 rounded-2xl border transition cursor-pointer ${
                      permission === option.id
                        ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/15'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-extrabold text-slate-800">{option.label}</div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      {option.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer disabled:opacity-50"
              >
                {isCreating ? 'Creating...' : 'Create invite link'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs text-emerald-900 leading-relaxed space-y-1">
              <p className="font-extrabold text-sm">Invite link ready</p>
              <p>Copy the link below and send it to your friends — or open email.</p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Invite link
              </label>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] text-slate-600 break-all leading-relaxed">{result.shareLink}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={copyLink}
                className={`py-3 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                  copied
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                {copied ? '✓ Copied!' : '📋 Copy link'}
              </button>
              <button
                type="button"
                onClick={openEmail}
                className="py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold rounded-xl transition cursor-pointer"
              >
                ✉️ Open email
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
