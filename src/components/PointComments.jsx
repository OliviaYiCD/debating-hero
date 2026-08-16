import React, { useState } from 'react';

export default function PointComments({
  comments = [],
  canComment = false,
  onAddComment,
}) {
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!draft.trim() || !onAddComment) return;
    try {
      setIsSending(true);
      await onAddComment(draft);
      setDraft('');
    } finally {
      setIsSending(false);
    }
  };

  if (!canComment && comments.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3 space-y-2">
      <div className="text-[10px] font-black uppercase tracking-wider text-amber-700">
        Comments
      </div>

      {comments.length === 0 ? (
        <p className="text-[11px] text-slate-500">No comments yet.</p>
      ) : (
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="bg-white border border-amber-100 rounded-lg px-2.5 py-2 text-[11px]"
            >
              <div className="flex justify-between gap-2 mb-0.5">
                <span className="font-bold text-slate-700">{comment.author_name || 'Hero'}</span>
                <span className="text-slate-400">
                  {comment.created_at
                    ? new Date(comment.created_at).toLocaleString()
                    : ''}
                </span>
              </div>
              <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">{comment.body}</p>
            </div>
          ))}
        </div>
      )}

      {canComment && (
        <form onSubmit={handleSubmit} className="flex gap-2 pt-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment on this point..."
            className="flex-1 bg-white border border-amber-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-amber-400"
          />
          <button
            type="submit"
            disabled={isSending || !draft.trim()}
            className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded-lg cursor-pointer disabled:opacity-40"
          >
            {isSending ? '...' : 'Post'}
          </button>
        </form>
      )}
    </div>
  );
}
