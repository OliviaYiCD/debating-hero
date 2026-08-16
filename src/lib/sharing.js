import { supabase } from '../supabaseClient';

export const SHARE_PERMISSIONS = {
  view: {
    id: 'view',
    label: 'View only',
    description: 'Can open the workspace and leave comments on each speech point. Cannot edit or save the draft.',
  },
  edit: {
    id: 'edit',
    label: 'Can edit',
    description: 'Can co-edit the same topic workspace and save changes with you.',
  },
};

export function buildShareLink(inviteToken) {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://debating-hero.vercel.app';
  return `${base}/?share=${encodeURIComponent(inviteToken)}`;
}

export function getShareTokenFromUrl() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('share');
}

export function clearShareTokenFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('share')) return;
  url.searchParams.delete('share');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

export async function createTopicShare({ topic, ownerId, stance, permission }) {
  const topicSource = topic.category === 'Custom' || topic.user_id ? 'custom' : 'library';

  const { data, error } = await supabase
    .from('topic_shares')
    .insert({
      topic_id: topic.id,
      topic_source: topicSource,
      topic_title: topic.title || 'Debate Topic',
      owner_id: ownerId,
      stance,
      shared_with_email: null,
      permission,
      status: 'open',
      shared_with_user_id: null,
    })
    .select('*')
    .single();

  if (error) throw error;

  return {
    share: data,
    shareLink: buildShareLink(data.invite_token),
  };
}

export function buildShareMailto({ topicTitle, ownerName, shareLink, permission, stance }) {
  const subject = encodeURIComponent(
    `${ownerName || 'A teammate'} shared “${topicTitle}” on Debating Hero`
  );
  const permissionLabel = permission === 'edit' ? 'can edit' : 'view only';
  const body = encodeURIComponent(
    `Hi!\n\nI shared the debate topic “${topicTitle}” with you on Debating Hero (${stance}, ${permissionLabel}).\n\nOpen this link to join:\n${shareLink}\n\nIf you don’t have an account yet, sign up first, then open the link again.\n`
  );
  return `mailto:?subject=${subject}&body=${body}`;
}

export async function fetchIncomingShares(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from('topic_share_members')
    .select('joined_at, share:topic_shares(*)')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });

  if (error) throw error;

  return (data || [])
    .map((row) => row.share)
    .filter(Boolean)
    .filter((share) => share.owner_id !== userId);
}

export async function acceptShareByToken(token, userId, email) {
  if (!token || !userId) return null;

  const { data: share, error } = await supabase
    .from('topic_shares')
    .select('*')
    .eq('invite_token', token)
    .eq('status', 'open')
    .maybeSingle();

  if (error) throw error;
  if (!share) throw new Error('This invite link is invalid or has expired.');

  if (share.owner_id === userId) {
    throw new Error('This is your own share link.');
  }

  const { error: memberError } = await supabase.from('topic_share_members').upsert(
    {
      share_id: share.id,
      user_id: userId,
      email: (email || '').trim().toLowerCase() || null,
    },
    { onConflict: 'share_id,user_id' }
  );

  if (memberError) throw memberError;

  return {
    ...share,
    status: 'accepted',
    shared_with_user_id: userId,
  };
}

export async function acceptPendingSharesForUser() {
  // Link invites are claimed via acceptShareByToken; nothing email-based to auto-accept.
  return [];
}

export async function fetchPointComments({ ownerId, topicId, stance }) {
  const { data, error } = await supabase
    .from('topic_point_comments')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('topic_id', topicId)
    .eq('stance', stance)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function addPointComment({
  ownerId,
  topicId,
  stance,
  targetKey,
  body,
  authorId,
  authorName,
}) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Comment cannot be empty.');

  const { data, error } = await supabase
    .from('topic_point_comments')
    .insert([
      {
        owner_id: ownerId,
        topic_id: topicId,
        stance,
        target_key: targetKey,
        body: trimmed,
        author_id: authorId,
        author_name: authorName || 'Hero',
      },
    ])
    .select('*')
    .single();

  if (error) throw error;
  return data;
}
