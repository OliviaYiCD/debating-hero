import { supabase } from '../supabaseClient';

const PENDING_SHARE_KEY = 'debating_hero_pending_share';

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

export function rememberPendingShareToken(token = getShareTokenFromUrl()) {
  if (typeof window === 'undefined' || !token) return null;
  try {
    window.localStorage.setItem(PENDING_SHARE_KEY, token);
  } catch {
    // ignore storage failures (private mode, etc.)
  }
  return token;
}

export function getPendingShareToken() {
  if (typeof window === 'undefined') return null;
  const fromUrl = getShareTokenFromUrl();
  if (fromUrl) {
    rememberPendingShareToken(fromUrl);
    return fromUrl;
  }
  try {
    return window.localStorage.getItem(PENDING_SHARE_KEY);
  } catch {
    return null;
  }
}

export function clearPendingShareToken() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PENDING_SHARE_KEY);
  } catch {
    // ignore
  }
}

export function clearShareTokenFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('share')) return;
  url.searchParams.delete('share');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);
}

export function buildAuthRedirectUrl() {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://debating-hero.vercel.app';
  const token = getPendingShareToken();
  return token ? `${base}/?share=${encodeURIComponent(token)}` : base;
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

  const { data: memberRows, error: memberError } = await supabase
    .from('topic_share_members')
    .select('share_id, joined_at')
    .eq('user_id', userId)
    .order('joined_at', { ascending: false });

  if (memberError) throw memberError;

  const ids = (memberRows || []).map((row) => row.share_id).filter(Boolean);
  if (!ids.length) return [];

  const { data: shares, error: sharesError } = await supabase
    .from('topic_shares')
    .select('*')
    .in('id', ids);

  if (sharesError) throw sharesError;

  const byId = new Map((shares || []).map((share) => [share.id, share]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .filter((share) => share.owner_id !== userId);
}

export async function acceptShareByToken(token, userId) {
  if (!token || !userId) return null;

  const { data: share, error } = await supabase.rpc('join_topic_share_by_token', {
    p_token: token,
  });

  if (error) {
    // Fallback for DBs that have not run the join RPC migration yet.
    const { data: legacyShare, error: legacyError } = await supabase
      .from('topic_shares')
      .select('*')
      .eq('invite_token', token)
      .eq('status', 'open')
      .maybeSingle();

    if (legacyError) throw legacyError;
    if (!legacyShare) throw new Error(error.message || 'This invite link is invalid or has expired.');
    if (legacyShare.owner_id === userId) {
      throw new Error('This is your own share link.');
    }

    const { error: memberError } = await supabase.from('topic_share_members').insert({
      share_id: legacyShare.id,
      user_id: userId,
    });

    if (memberError && memberError.code !== '23505') {
      throw new Error(error.message || memberError.message);
    }

    return {
      ...legacyShare,
      status: 'accepted',
      shared_with_user_id: userId,
    };
  }

  if (!share) throw new Error('This invite link is invalid or has expired.');
  if (share.owner_id === userId) {
    throw new Error('This is your own share link.');
  }

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
