import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { supabase } from './supabaseClient';
import AuthModal from './components/AuthModal';
import LandingPage from './components/LandingPage';
import ShareTopicModal from './components/ShareTopicModal';
import PointComments from './components/PointComments';
import {
  acceptPendingSharesForUser,
  acceptShareByToken,
  addPointComment,
  clearPendingShareToken,
  clearShareTokenFromUrl,
  fetchIncomingShares,
  fetchPointComments,
  getPendingShareToken,
  rememberPendingShareToken,
} from './lib/sharing';

const ITEMS_PER_PAGE = 12;
const HUMANITIES_PER_PAGE = 12;
const XP_PER_LEVEL = 100; // 100 XP = 1 Level

// Rank Title Helper based on Level
const getRankTitle = (level) => {
  if (level >= 10) return 'Legendary Orator 🏆';
  if (level >= 7) return 'Debate Champion ⚔️';
  if (level >= 5) return 'Master Rhetorician 📜';
  if (level >= 3) return 'Apprentice Speaker 🎙️';
  return 'Novice Debater 🌱';
};

// Helper to derive display name and avatar initial
const getHeroInfo = (profile, session) => {
  const name =
    profile?.username ||
    session?.user?.user_metadata?.full_name ||
    session?.user?.email?.split('@')[0] ||
    'Hero Debater';

  const initial = name.charAt(0).toUpperCase();

  return { name, initial };
};

const DEFAULT_SPEECH = {
  topicIntro: '',
  point1: '',
  point2: '',
  point3: '',
  conclusion: '',
};

const SPEECH_STAGE_KEYS = ['topicIntro', 'point1', 'point2', 'point3', 'conclusion'];

const SPEECH_STAGE_CARDS = [
  {
    key: 'topicIntro',
    title: 'Topic Introduction',
    time: '1.5 Mins',
    color: 'bg-blue-600',
    placeholder: 'Define the topic and introduce your main team stance...',
  },
  {
    key: 'point1',
    title: 'POINT 1',
    time: '2 Mins',
    color: 'bg-blue-500',
    placeholder: 'State your first strongest argument using the PERIL method...',
  },
  {
    key: 'point2',
    title: 'POINT 2',
    time: '2 Mins',
    color: 'bg-blue-400',
    placeholder: 'State your second argument with supporting evidence...',
  },
  {
    key: 'point3',
    title: 'POINT 3',
    time: '1.5 Mins',
    color: 'bg-blue-300',
    placeholder: 'State your final supporting argument...',
  },
  {
    key: 'conclusion',
    title: 'Conclusion',
    time: '1 Min',
    color: 'bg-indigo-600',
    placeholder: 'Summarize your main points and deliver a powerful final statement...',
  },
];

// Shared Hero Tools for Affirmative & Negative (PERIL framework)
const HERO_TOOL_GROUPS = [
  {
    label: 'P — Point',
    phrases: ['Firstly...', 'My main point is...', 'Our team proves...'],
  },
  {
    label: 'E — Explain',
    phrases: ['This means...', 'In other words...', 'To put it simply...'],
  },
  {
    label: 'R — Reasoning',
    phrases: ['Because...', 'The reason is...', 'This is true since...'],
  },
  {
    label: 'I — Impact',
    phrases: ['This leads to...', 'The impact is...', 'This matters because...'],
  },
  {
    label: 'L — Linking',
    phrases: ['This proves that...', 'Linking back to the topic...', 'That is why our side wins...'],
  },
];

// Persist completion inside speech_data — user_debates has no is_completed column
const SPEECH_META_KEY = '__meta';

const createRebuttalRow = () => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  point: '',
  rebuttal: '',
});

const createDefaultRebuttalPlanner = () => [createRebuttalRow()];

const unpackSpeechData = (speechData) => {
  if (!speechData || typeof speechData !== 'object') {
    return { ...DEFAULT_SPEECH };
  }
  const { [SPEECH_META_KEY]: _meta, ...fields } = speechData;
  const next = { ...DEFAULT_SPEECH };
  SPEECH_STAGE_KEYS.forEach((key) => {
    if (typeof fields[key] === 'string') next[key] = fields[key];
  });
  return next;
};

const unpackRebuttalPlanner = (speechData) => {
  const rows = speechData?.[SPEECH_META_KEY]?.rebuttalPlanner;
  if (!Array.isArray(rows) || rows.length === 0) {
    return createDefaultRebuttalPlanner();
  }
  return rows.map((row) => ({
    id: row.id || createRebuttalRow().id,
    point: typeof row.point === 'string' ? row.point : '',
    rebuttal: typeof row.rebuttal === 'string' ? row.rebuttal : '',
  }));
};

const packSpeechData = (speechInputs, isCompleted = false, rebuttalPlanner = []) => {
  const packed = {
    [SPEECH_META_KEY]: {
      is_completed: Boolean(isCompleted),
      rebuttalPlanner: (rebuttalPlanner || []).map((row) => ({
        id: row.id,
        point: row.point || '',
        rebuttal: row.rebuttal || '',
      })),
    },
  };
  SPEECH_STAGE_KEYS.forEach((key) => {
    packed[key] = speechInputs[key] || '';
  });
  return packed;
};

const getDebateCompleted = (debate) => {
  if (!debate) return false;
  if (typeof debate.is_completed === 'boolean') return debate.is_completed;
  return Boolean(debate.speech_data?.[SPEECH_META_KEY]?.is_completed);
};

// Compact pagination: 1, 2, …, last (includes current when needed)
const getCompactPageItems = (currentPage, totalPages) => {
  if (totalPages <= 3) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set([1, 2, totalPages, currentPage]);
  const sorted = [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);

  const items = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      items.push('ellipsis');
    }
    items.push(sorted[i]);
  }
  return items;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('explorer'); // 'explorer' | 'my-topics' | 'arena' | 'rebuttal-planner' | 'hub' | 'profile'
  const [selectedFilter, setSelectedFilter] = useState('All Topics');
  const [myTopicsView, setMyTopicsView] = useState('custom'); // 'custom' | 'teamwork'
  const [searchQuery, setSearchQuery] = useState('');

  // Topic Pagination State
  const [currentPage, setCurrentPage] = useState(1);

  // Database Topics & User Debates State
  const [topics, setTopics] = useState([]);
  const [myTopics, setMyTopics] = useState([]); // Custom User Topics
  const [userDebatesMap, setUserDebatesMap] = useState({}); // { [topicId_stance]: { speech_data, completed } }
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [selectedTopicModal, setSelectedTopicModal] = useState(null); // Active Topic Modal
  const [shareModalTopic, setShareModalTopic] = useState(null);
  const [incomingShares, setIncomingShares] = useState([]);
  const [collaboration, setCollaboration] = useState(null); // { ownerId, permission, shareId }
  const [pointComments, setPointComments] = useState([]);
  const [activeTopic, setActiveTopic] = useState(null);               // Topic being practiced
  const [chosenStance, setChosenStance] = useState('Affirmative');     // 'Affirmative' | 'Negative'

  // Custom Topic Form Input State
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicDesc, setNewTopicDesc] = useState('');
  const [isCreatingTopic, setIsCreatingTopic] = useState(false);

  // Editing Custom Topic State
  const [editingTopicId, setEditingTopicId] = useState(null);
  const [editTopicTitle, setEditTopicTitle] = useState('');
  const [editTopicDesc, setEditTopicDesc] = useState('');

  // Database Humanities Knowledge State
  const [humanitiesData, setHumanitiesData] = useState([]);
  const [loadingHumanities, setLoadingHumanities] = useState(true);
  const [selectedHumanitiesFilter, setSelectedHumanitiesFilter] = useState('All');
  
  // Humanities Pagination & "I Know" Tracking State
  const [humanitiesPage, setHumanitiesPage] = useState(1);
  const [knownItems, setKnownItems] = useState(new Set()); // Set of known item IDs

  // Save State & Dirty State Tracking
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const [initialSpeechInputs, setInitialSpeechInputs] = useState(DEFAULT_SPEECH);

  // AI Feedback Modal / Loading State
  const [loadingAiStage, setLoadingAiStage] = useState(''); // Stores stage key currently calling AI
  const [aiModalContent, setAiModalContent] = useState(null); // { stageKey, stageName, feedbackText }

  // AI Score Modal State
  const [loadingAiScore, setLoadingAiScore] = useState(false);
  const [aiScoreData, setAiScoreData] = useState(null); // { score, feedbackText, strengths, improvements }

  // Streak Widget Popover State
  const [showStreakModal, setShowStreakModal] = useState(false);

  // Auth Modal Visibility State for Landing Page
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Arena Speech Input State
  const [speechInputs, setSpeechInputs] = useState(DEFAULT_SPEECH);
  const [rebuttalPlanner, setRebuttalPlanner] = useState(createDefaultRebuttalPlanner);
  const [initialRebuttalPlanner, setInitialRebuttalPlanner] = useState(createDefaultRebuttalPlanner);
  const [activeStage, setActiveStage] = useState('');

  // Learning Hub State
  const [activeLesson, setActiveLesson] = useState('peril');
  const [copiedPhrase, setCopiedPhrase] = useState('');

  // Supabase Auth & Profile State
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  const [nicknameStatus, setNicknameStatus] = useState(''); // '' | 'saved' | 'error'

  // Toast Notification State for Level Up / XP Earned
  const [xpToast, setXpToast] = useState('');

  // Fetch Topics & Humanities Knowledge from Supabase DB
  useEffect(() => {
    fetchTopics();
    fetchHumanitiesData();
  }, []);

  const showXpToast = (msg) => {
    setXpToast(msg);
    setTimeout(() => setXpToast(''), 3000);
  };

  // Check & Update Daily Streak Logic
  const checkAndUpdateStreak = async (currentProfile) => {
    if (!session || !currentProfile) return currentProfile?.streak_count || 0;

    const todayStr = new Date().toISOString().split('T')[0];
    const lastActive = currentProfile.last_active_date;
    let newStreak = currentProfile.streak_count || 0;

    if (!lastActive) {
      newStreak = 1;
    } else if (lastActive === todayStr) {
      return newStreak;
    } else {
      const lastDate = new Date(lastActive);
      const todayDate = new Date(todayStr);
      const diffTime = Math.abs(todayDate - lastDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        newStreak += 1;
      } else if (diffDays > 1) {
        newStreak = 1;
      }
    }

    setProfile((prev) => ({
      ...prev,
      streak_count: newStreak,
      last_active_date: todayStr,
    }));

    try {
      await supabase
        .from('profiles')
        .update({
          streak_count: newStreak,
          last_active_date: todayStr,
        })
        .eq('id', session.user.id);
    } catch (err) {
      console.error('Error updating daily streak:', err.message);
    }

    return newStreak;
  };

  const awardUserXp = async (xpAmount) => {
    if (!session || !profile) return;

    await checkAndUpdateStreak(profile);

    const newXp = Math.max(0, (profile.xp || 0) + xpAmount);
    const newLevel = Math.floor(newXp / XP_PER_LEVEL) + 1;
    const newRankTitle = getRankTitle(newLevel);

    const leveledUp = newLevel > (profile.level || 1);

    setProfile((prev) => ({
      ...prev,
      xp: newXp,
      level: newLevel,
      rank_title: newRankTitle,
    }));

    if (leveledUp) {
      showXpToast(`🎉 LEVEL UP! You are now Level ${newLevel} (${newRankTitle})!`);
    } else if (xpAmount > 0) {
      showXpToast(`+${xpAmount} XP Earned! 🌟`);
    }

    try {
      await supabase
        .from('profiles')
        .update({
          xp: newXp,
          level: newLevel,
          rank_title: newRankTitle,
        })
        .eq('id', session.user.id);
    } catch (err) {
      console.error('Error updating XP in profile:', err.message);
    }
  };

  const fetchTopics = async () => {
    try {
      setLoadingTopics(true);
      const { data, error } = await supabase
        .from('topics')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setTopics(data);
      }
    } catch (err) {
      console.error('Error fetching topics from Supabase:', err.message);
    } finally {
      setLoadingTopics(false);
    }
  };

  const fetchUserDebates = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('user_debates')
        .select('*')
        .eq('user_id', userId);

      if (error) throw error;

      if (data) {
        const debateMap = {};
        data.forEach((item) => {
          const normalized = {
            ...item,
            is_completed: getDebateCompleted(item),
          };
          debateMap[`${item.topic_id}_${item.stance}`] = normalized;
          // Also set generic topic_id key for card badges
          if (!debateMap[item.topic_id] || normalized.is_completed) {
            debateMap[item.topic_id] = normalized;
          }
        });
        setUserDebatesMap(debateMap);
      }
    } catch (err) {
      console.error('Error fetching user debates:', err.message);
    }
  };

  const fetchMyTopics = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('user_topics')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        setMyTopics(data);
      }
    } catch (err) {
      console.error('Error fetching custom user topics:', err.message);
    }
  };

  const handleCreateCustomTopic = async (e) => {
    e.preventDefault();
    if (!newTopicTitle.trim()) return;

    if (!session) {
      setShowAuthModal(true);
      return;
    }

    try {
      setIsCreatingTopic(true);
      const newTopicObj = {
        user_id: session.user.id,
        title: newTopicTitle.trim(),
        description: newTopicDesc.trim() || 'Custom user created topic.',
        category: 'Custom',
        difficulty: 1,
      };

      const { data, error } = await supabase
        .from('user_topics')
        .insert([newTopicObj])
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setMyTopics((prev) => [data, ...prev]);
        setNewTopicTitle('');
        setNewTopicDesc('');
      }
    } catch (err) {
      console.error('Error saving custom topic:', err.message);
      alert('Could not save custom topic. Please check your connection.');
    } finally {
      setIsCreatingTopic(false);
    }
  };

  const handleStartEdit = (topic) => {
    setEditingTopicId(topic.id);
    setEditTopicTitle(topic.title);
    setEditTopicDesc(topic.description || '');
  };

  const handleSaveEdit = async (topicId) => {
    if (!editTopicTitle.trim()) return;

    try {
      const { error } = await supabase
        .from('user_topics')
        .update({
          title: editTopicTitle.trim(),
          description: editTopicDesc.trim() || 'Custom user created topic.',
        })
        .eq('id', topicId)
        .eq('user_id', session.user.id);

      if (error) throw error;

      setMyTopics((prev) =>
        prev.map((t) =>
          t.id === topicId
            ? { ...t, title: editTopicTitle.trim(), description: editTopicDesc.trim() || 'Custom user created topic.' }
            : t
        )
      );

      setEditingTopicId(null);
    } catch (err) {
      console.error('Error updating topic:', err.message);
      alert('Failed to update topic.');
    }
  };

  const handleDeleteTopic = async (topicId) => {
    if (!window.confirm('Are you sure you want to delete this topic?')) return;

    try {
      const { error } = await supabase
        .from('user_topics')
        .delete()
        .eq('id', topicId)
        .eq('user_id', session.user.id);

      if (error) throw error;

      setMyTopics((prev) => prev.filter((t) => t.id !== topicId));
    } catch (err) {
      console.error('Error deleting topic:', err.message);
      alert('Failed to delete topic.');
    }
  };

  const fetchHumanitiesData = async () => {
    try {
      setLoadingHumanities(true);
      const { data, error } = await supabase
        .from('humanities_knowledge')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (data) {
        setHumanitiesData(data);
      }
    } catch (err) {
      console.error('Error fetching humanities knowledge from Supabase:', err.message);
    } finally {
      setLoadingHumanities(false);
    }
  };

  const fetchUserHumanitiesProgress = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('user_humanities_progress')
        .select('humanities_id')
        .eq('user_id', userId);

      if (error) throw error;

      if (data) {
        const knownSet = new Set(data.map((row) => row.humanities_id));
        setKnownItems(knownSet);
      }
    } catch (err) {
      console.error('Error fetching humanities progress:', err.message);
    }
  };

  useEffect(() => {
    rememberPendingShareToken();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user);
        fetchMyTopics(session.user.id);
        fetchUserDebates(session.user.id);
        fetchUserHumanitiesProgress(session.user.id);
        bootstrapSharesForUser(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user);
        fetchMyTopics(session.user.id);
        fetchUserDebates(session.user.id);
        fetchUserHumanitiesProgress(session.user.id);
        bootstrapSharesForUser(session.user);
        setShowAuthModal(false);
      } else {
        setProfile(null);
        setMyTopics([]);
        setUserDebatesMap({});
        setKnownItems(new Set());
        setIncomingShares([]);
        setCollaboration(null);
        setPointComments([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // If someone opens an invite link while logged out, remember it and prompt sign-in/sign-up
  useEffect(() => {
    const token = getPendingShareToken();
    if (token && !session) {
      rememberPendingShareToken(token);
      setShowAuthModal(true);
    }
  }, [session]);

  const bootstrapSharesForUser = async (user) => {
    if (!user) return;

    try {
      await acceptPendingSharesForUser();

      const token = getPendingShareToken();
      let accepted = null;
      if (token) {
        try {
          accepted = await acceptShareByToken(token, user.id);
          clearShareTokenFromUrl();
          clearPendingShareToken();
          if (accepted) {
            alert(`Invite accepted! Opening “${accepted.topic_title}”. Find it anytime under My Topics → Teamwork.`);
            setMyTopicsView('teamwork');
            setActiveTab('my-topics');
            await openSharedWorkspace(accepted);
          }
        } catch (err) {
          console.error('Share invite error:', err.message);
          alert(err.message || 'Could not open this share invite.');
        }
      }

      const shares = await fetchIncomingShares(user.id);
      if (accepted && !shares.some((share) => share.id === accepted.id)) {
        setIncomingShares([accepted, ...shares]);
      } else {
        setIncomingShares(shares);
      }
    } catch (err) {
      console.error('Error bootstrapping shares:', err.message);
    }
  };

  const resolveTopicForShare = async (share) => {
    if (share.topic_source === 'custom') {
      const local = myTopics.find((t) => t.id === share.topic_id);
      if (local) return local;

      const { data, error } = await supabase
        .from('user_topics')
        .select('*')
        .eq('id', share.topic_id)
        .maybeSingle();
      if (error) throw error;
      if (data) return data;
    }

    const libraryTopic = topics.find((t) => t.id === share.topic_id);
    if (libraryTopic) return libraryTopic;

    const { data, error } = await supabase
      .from('topics')
      .select('*')
      .eq('id', share.topic_id)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  const loadPointCommentsForDoc = async (ownerId, topicId, stance) => {
    try {
      const comments = await fetchPointComments({ ownerId, topicId, stance });
      setPointComments(comments);
    } catch (err) {
      console.error('Error loading comments:', err.message);
      setPointComments([]);
    }
  };

  const openSharedWorkspace = async (share) => {
    const topic = await resolveTopicForShare(share);
    if (!topic) {
      alert('Could not find this shared topic.');
      return;
    }

    setCollaboration({
      ownerId: share.owner_id,
      permission: share.permission,
      shareId: share.id,
    });
    setChosenStance(share.stance);
    setActiveTopic({
      ...topic,
      title: topic.title || share.topic_title,
    });
    setActiveTab(share.permission === 'view' ? 'arena' : 'arena');
    setSaveStatus('');
    await loadSavedDraft(share.topic_id, share.stance, share.owner_id);
    await loadPointCommentsForDoc(share.owner_id, share.topic_id, share.stance);
    setActiveStage('topicIntro');
  };

  const handleOpenShareModal = (topic) => {
    if (!session) {
      setShowAuthModal(true);
      return;
    }
    setShareModalTopic(topic);
  };

  const debateOwnerId = collaboration?.ownerId || session?.user?.id;
  const canEditWorkspace = !collaboration || collaboration.permission === 'edit';
  const canCommentOnPoints = collaboration?.permission === 'view';

  const handleAddPointComment = async (targetKey, body) => {
    if (!session || !activeTopic || !debateOwnerId) return;
    const { name } = getHeroInfo(profile, session);
    const created = await addPointComment({
      ownerId: debateOwnerId,
      topicId: activeTopic.id,
      stance: chosenStance,
      targetKey,
      body,
      authorId: session.user.id,
      authorName: name,
    });
    setPointComments((prev) => [...prev, created]);
  };

  const fetchProfile = async (user) => {
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code === 'PGRST116') {
        const defaultName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Hero';
        const avatarUrl = user.user_metadata?.avatar_url || '';

        const { data: newProfile } = await supabase
          .from('profiles')
          .insert([
            {
              id: user.id,
              username: defaultName,
              avatar_url: avatarUrl,
              level: 1,
              xp: 0,
              rank_title: 'Novice Debater',
              streak_count: 0,
            },
          ])
          .select()
          .single();

        data = newProfile;
      }

      setProfile(data);
      if (data?.username) {
        setNicknameDraft(data.username);
      } else {
        const fallback =
          user.user_metadata?.full_name || user.email?.split('@')[0] || 'Hero';
        setNicknameDraft(fallback);
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
  };

  const handleSaveNickname = async () => {
    if (!session || !profile) return;

    const nextName = nicknameDraft.trim();
    if (!nextName) {
      alert('Please enter a nickname.');
      return;
    }

    if (nextName === (profile.username || '').trim()) {
      setIsEditingNickname(false);
      setNicknameStatus('saved');
      setTimeout(() => setNicknameStatus(''), 2000);
      return;
    }

    try {
      setIsSavingNickname(true);
      setNicknameStatus('');

      const { data, error } = await supabase
        .from('profiles')
        .update({ username: nextName })
        .eq('id', session.user.id)
        .select()
        .single();

      if (error) throw error;

      setProfile(data);
      setNicknameDraft(data.username || nextName);
      setIsEditingNickname(false);
      setNicknameStatus('saved');
      setTimeout(() => setNicknameStatus(''), 2500);
    } catch (err) {
      console.error('Error updating nickname:', err.message);
      setNicknameStatus('error');
      alert(`Could not update nickname: ${err.message || 'Please try again.'}`);
    } finally {
      setIsSavingNickname(false);
    }
  };

  const handleCancelNicknameEdit = () => {
    const { name } = getHeroInfo(profile, session);
    setNicknameDraft(profile?.username || name || '');
    setIsEditingNickname(false);
    setNicknameStatus('');
  };

  const toggleKnowItem = async (itemId) => {
    if (!session) {
      setShowAuthModal(true);
      return;
    }

    const isCurrentlyKnown = knownItems.has(itemId);

    setKnownItems((prev) => {
      const updated = new Set(prev);
      if (isCurrentlyKnown) {
        updated.delete(itemId);
      } else {
        updated.add(itemId);
      }
      return updated;
    });

    try {
      if (isCurrentlyKnown) {
        const { error } = await supabase
          .from('user_humanities_progress')
          .delete()
          .eq('user_id', session.user.id)
          .eq('humanities_id', itemId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_humanities_progress')
          .insert([{ user_id: session.user.id, humanities_id: itemId }]);

        if (error) throw error;
      }
    } catch (err) {
      console.error('Error syncing humanities progress:', err.message);
      setKnownItems((prev) => {
        const reverted = new Set(prev);
        if (isCurrentlyKnown) reverted.add(itemId);
        else reverted.delete(itemId);
        return reverted;
      });
    }
  };

  const loadSavedDraft = async (topicId, stance, userId, { preservePlanner = false } = {}) => {
    try {
      const { data, error } = await supabase
        .from('user_debates')
        .select('speech_data')
        .eq('user_id', userId)
        .eq('topic_id', topicId)
        .eq('stance', stance)
        .maybeSingle();

      if (error) throw error;

      if (data?.speech_data) {
        const fields = unpackSpeechData(data.speech_data);
        setSpeechInputs(fields);
        setInitialSpeechInputs(fields);
        if (!preservePlanner) {
          const planner = unpackRebuttalPlanner(data.speech_data);
          setRebuttalPlanner(planner);
          setInitialRebuttalPlanner(planner);
        }
      } else {
        setSpeechInputs(DEFAULT_SPEECH);
        setInitialSpeechInputs(DEFAULT_SPEECH);
        if (!preservePlanner) {
          const planner = createDefaultRebuttalPlanner();
          setRebuttalPlanner(planner);
          setInitialRebuttalPlanner(planner);
        }
      }
    } catch (err) {
      console.error('Error loading saved draft:', err.message);
    }
  };

  // Check if topic draft has changes comparing to loaded version
  const hasUnsavedChanges =
    JSON.stringify(speechInputs) !== JSON.stringify(initialSpeechInputs) ||
    JSON.stringify(rebuttalPlanner) !== JSON.stringify(initialRebuttalPlanner);

  const isSpeechFullyCompleted = () =>
    SPEECH_STAGE_KEYS.every((key) => speechInputs[key] && speechInputs[key].trim().length > 0);

  // Save Progress (NO XP awarded here - saves WIP status)
  const handleSaveSpeech = async () => {
    if (!session) {
      setShowAuthModal(true);
      return;
    }

    if (!canEditWorkspace) {
      alert('This share is view-only. You can leave comments on each point, but you cannot edit or save the draft.');
      return;
    }

    if (!activeTopic || !hasUnsavedChanges || !debateOwnerId) return;

    try {
      setIsSaving(true);
      setSaveStatus('saving');

      const existingDebate = userDebatesMap[`${activeTopic.id}_${chosenStance}`];
      const currentCompleted = getDebateCompleted(existingDebate);

      const { error } = await supabase
        .from('user_debates')
        .upsert(
          {
            user_id: debateOwnerId,
            topic_id: activeTopic.id,
            stance: chosenStance,
            speech_data: packSpeechData(speechInputs, currentCompleted, rebuttalPlanner),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,topic_id,stance' }
        );

      if (error) throw error;

      setSaveStatus('saved');
      setInitialSpeechInputs(speechInputs);
      setInitialRebuttalPlanner(rebuttalPlanner);
      
      // Update local state map
      setUserDebatesMap((prev) => ({
        ...prev,
        [`${activeTopic.id}_${chosenStance}`]: {
          speech_data: packSpeechData(speechInputs, currentCompleted, rebuttalPlanner),
          is_completed: currentCompleted,
        },
        [activeTopic.id]: {
          speech_data: packSpeechData(speechInputs, currentCompleted, rebuttalPlanner),
          is_completed: currentCompleted,
        },
      }));

      setTimeout(() => setSaveStatus(''), 2500);
    } catch (err) {
      console.error('Error saving speech:', err.message);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCallGeminiCoach = async (stageKey, stageName) => {
    if (!activeTopic) return;

    try {
      setLoadingAiStage(stageKey);

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

      if (!apiKey) {
        alert('Missing API Key! Make sure VITE_GEMINI_API_KEY is set in .env.local');
        return;
      }

      const ai = new GoogleGenAI({ apiKey });

      const promptText = `You are an encouraging debating coach for kids aged 10-14.
Help polish the student's debate speech section for maximum impact, clarity, and strong signposting (like "Firstly", "Furthermore", "This proves that...").
Keep your tone energetic, constructive, and age-appropriate.

Topic: "${activeTopic.title}"
Stance: ${chosenStance}
Speech Section: ${stageName}
Student Draft: "${speechInputs[stageKey] || '(No draft provided yet)'}"

Task:
1. Provide a polished, high-impact version of this section (keep it concise and easy to speak aloud).
2. Give 1 quick pro tip on how to deliver this point.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: promptText,
      });

      const feedbackText =
        response.text || "Sorry, I couldn't generate coaching feedback right now. Please try again!";

      setAiModalContent({
        stageKey,
        stageName,
        feedbackText,
      });
    } catch (err) {
      console.error('Error fetching Gemini AI coach suggestion:', err);
      alert(`Could not contact Gemini AI coach: ${err.message || 'Failed to connect'}`);
    } finally {
      setLoadingAiStage('');
    }
  };

  // AI Speech Evaluation, Scoring (1-10 Score), and Completion Logic (+10 XP IF SCORE > 5)
  const handleEvaluateFullSpeech = async () => {
    if (!session) {
      setShowAuthModal(true);
      return;
    }

    if (!activeTopic) return;

    if (!isSpeechFullyCompleted()) {
      alert('Please fill out all speech section fields before submitting for an AI Score!');
      return;
    }

    const speechText = `Intro: ${speechInputs.topicIntro}\nPoint 1: ${speechInputs.point1}\nPoint 2: ${speechInputs.point2}\nPoint 3: ${speechInputs.point3}\nConclusion: ${speechInputs.conclusion}`;

    try {
      setLoadingAiScore(true);

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        alert('Missing API Key! Make sure VITE_GEMINI_API_KEY is set in .env.local');
        return;
      }

      const ai = new GoogleGenAI({ apiKey });

      const promptText = `You are a friendly, fair youth debate judge evaluating a student (age 10-14).
Evaluate the complete debate speech below for clarity, relevant arguments, and effort. If the text consists of gibberish, random letters, or meaningless filler, give it a score lower than 5.

Topic: "${activeTopic.title}"
Stance: ${chosenStance}

Full Speech Draft:
${speechText}

Return your response strictly in valid JSON format with no markdown formatting around it:
{
  "score": <number from 1 to 10>,
  "strengths": ["point 1", "point 2"],
  "improvements": ["point 1", "point 2"],
  "summary": "<2 sentence summary advice>"
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: promptText,
      });

      let parsedResult;
      try {
        const cleanText = (response.text || '')
          .replace(/```json/g, '')
          .replace(/```/g, '')
          .trim();
        parsedResult = JSON.parse(cleanText);
      } catch (e) {
        // Fallback if parsing fails
        parsedResult = {
          score: 6,
          strengths: ['Great effort in putting together a full speech!'],
          improvements: ['Work on expanding your reasons using the PERIL formula.'],
          summary: 'A solid attempt at crafting your speech draft!',
        };
      }

      const numericScore = Number(parsedResult.score) || 0;
      const passedScoreThreshold = numericScore > 5;

      const existingDebate = userDebatesMap[`${activeTopic.id}_${chosenStance}`];
      const isAlreadyCompleted = getDebateCompleted(existingDebate);

      // Update Supabase if score > 5
      if (passedScoreThreshold && canEditWorkspace && debateOwnerId) {
        await supabase
          .from('user_debates')
          .upsert(
            {
              user_id: debateOwnerId,
              topic_id: activeTopic.id,
              stance: chosenStance,
              speech_data: packSpeechData(speechInputs, true, rebuttalPlanner),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,topic_id,stance' }
          );

        setUserDebatesMap((prev) => ({
          ...prev,
          [`${activeTopic.id}_${chosenStance}`]: {
            speech_data: packSpeechData(speechInputs, true, rebuttalPlanner),
            is_completed: true,
          },
          [activeTopic.id]: {
            speech_data: packSpeechData(speechInputs, true, rebuttalPlanner),
            is_completed: true,
          },
        }));

        if (!isAlreadyCompleted && debateOwnerId === session.user.id) {
          awardUserXp(10);
        }
      }

      setAiScoreData({
        score: numericScore,
        passed: passedScoreThreshold,
        strengths: parsedResult.strengths || [],
        improvements: parsedResult.improvements || [],
        summary: parsedResult.summary || '',
        isAlreadyCompleted,
      });
    } catch (err) {
      console.error('Error evaluating speech score:', err);
      alert('Could not generate AI speech score. Please try again!');
    } finally {
      setLoadingAiScore(false);
    }
  };

  const handleBeginPractice = () => {
    const topicToPractice = selectedTopicModal;
    setActiveTopic(topicToPractice);
    setSelectedTopicModal(null);
    setActiveTab('arena');
    setSaveStatus('');
    setCollaboration(null);
    setPointComments([]);

    if (session && topicToPractice) {
      // Keep rebuttal planner edits from the prep modal
      loadSavedDraft(topicToPractice.id, chosenStance, session.user.id, {
        preservePlanner: true,
      });
      setInitialRebuttalPlanner(rebuttalPlanner);
      loadPointCommentsForDoc(session.user.id, topicToPractice.id, chosenStance);
    } else {
      setSpeechInputs(DEFAULT_SPEECH);
      setInitialSpeechInputs(DEFAULT_SPEECH);
      setInitialRebuttalPlanner(rebuttalPlanner);
    }

    setActiveStage('topicIntro');
  };

  const handleOpenRebuttalPlanner = () => {
    const topicToPractice = selectedTopicModal;
    if (!topicToPractice && !activeTopic) return;

    const topic = topicToPractice || activeTopic;
    setActiveTopic(topic);
    setSelectedTopicModal(null);
    setActiveTab('rebuttal-planner');
    setSaveStatus('');

    if (session && topicToPractice) {
      loadSavedDraft(topic.id, chosenStance, session.user.id, {
        preservePlanner: true,
      });
      setInitialRebuttalPlanner(rebuttalPlanner);
    } else if (session && topic && !topicToPractice) {
      // Switching from Arena — keep current in-memory planner
      setInitialRebuttalPlanner(rebuttalPlanner);
    } else if (!session) {
      setInitialRebuttalPlanner(rebuttalPlanner);
    }
  };

  const hydrateRebuttalPlanner = (topicId, stance) => {
    const debate = userDebatesMap[`${topicId}_${stance}`];
    const planner = unpackRebuttalPlanner(debate?.speech_data);
    setRebuttalPlanner(planner);
    setInitialRebuttalPlanner(planner);
  };

  const openTopicModal = (topic) => {
    setSelectedTopicModal(topic);
    hydrateRebuttalPlanner(topic.id, chosenStance);
  };

  const updateRebuttalRow = (id, field, value) => {
    setRebuttalPlanner((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const addRebuttalRow = () => {
    setRebuttalPlanner((prev) => [...prev, createRebuttalRow()]);
  };

  const removeRebuttalRow = (id) => {
    setRebuttalPlanner((prev) => {
      if (prev.length <= 1) {
        return createDefaultRebuttalPlanner();
      }
      return prev.filter((row) => row.id !== id);
    });
  };

  const handleFilterChange = (cat) => {
    setSelectedFilter(cat);
    setCurrentPage(1);
  };

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handleHumanitiesFilterChange = (filterType) => {
    setSelectedHumanitiesFilter(filterType);
    setHumanitiesPage(1);
  };

  const handleCopyPhrase = (phrase) => {
    navigator.clipboard.writeText(phrase);
    setCopiedPhrase(phrase);
    setTimeout(() => setCopiedPhrase(''), 2000);
  };

  const insertHeroPhrase = (phrase) => {
    if (!activeStage || !canEditWorkspace) return;
    setSpeechInputs((prev) => ({
      ...prev,
      [activeStage]: prev[activeStage] ? prev[activeStage] + ' ' + phrase : phrase,
    }));
  };

  const sharedTopicIds = new Set(incomingShares.map((s) => s.topic_id));

  const filteredTopics = topics.filter((t) => {
    if (selectedFilter === '⏳ In Progress') {
      const debateInfo = userDebatesMap[t.id];
      return debateInfo && !debateInfo.is_completed;
    }
    const matchesCategory = selectedFilter === 'All Topics' || t.category === selectedFilter;
    const matchesSearch =
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const teamworkShares = incomingShares.filter((share) => {
    if (!searchQuery.trim()) return true;
    return (share.topic_title || '').toLowerCase().includes(searchQuery.toLowerCase());
  });

  const filteredMyTopics = myTopics.filter((t) => {
    if (selectedFilter === '⏳ In Progress') {
      const debateInfo = userDebatesMap[t.id];
      return debateInfo && !debateInfo.is_completed;
    }
    return true;
  });

  const filteredHumanities = humanitiesData.filter((item) => {
    if (selectedHumanitiesFilter === 'All') return true;
    return item.type?.toLowerCase() === selectedHumanitiesFilter.toLowerCase();
  });

  const totalPages = Math.ceil(filteredTopics.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedTopics = filteredTopics.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const totalHumanitiesPages = Math.ceil(filteredHumanities.length / HUMANITIES_PER_PAGE);
  const humanitiesStartIndex = (humanitiesPage - 1) * HUMANITIES_PER_PAGE;
  const paginatedHumanities = filteredHumanities.slice(humanitiesStartIndex, humanitiesStartIndex + HUMANITIES_PER_PAGE);

  const renderStars = (count) => '★'.repeat(count || 1) + '☆'.repeat(3 - (count || 1));

  const currentXp = profile?.xp || 0;
  const currentLevel = Math.floor(currentXp / XP_PER_LEVEL) + 1;
  const xpInCurrentLevel = currentXp % XP_PER_LEVEL;
  const streakCount = profile?.streak_count || 0;

  // Helper to render topic status badge (In Progress / Completed)
  const renderTopicStatusBadge = (topicId) => {
    const debate = userDebatesMap[topicId];
    if (!debate) return null;

    if (debate.is_completed) {
      return (
        <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
          <span>✓</span> COMPLETED
        </span>
      );
    }

    return (
      <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1 animate-pulse">
        <span>⏳</span> IN PROGRESS
      </span>
    );
  };

  // ==========================================
  // UNAUTHENTICATED LANDING PAGE
  // ==========================================
  if (!session) {
    return (
      <LandingPage
        showAuthModal={showAuthModal}
        onOpenAuth={() => setShowAuthModal(true)}
        onCloseAuth={() => setShowAuthModal(false)}
      />
    );
  }

  // ==========================================
  // AUTHENTICATED DASHBOARD (FOR LOGGED IN USERS)
  // ==========================================
  return (
    <div className="min-h-screen bg-[#F0F3F8] text-slate-800 flex font-sans w-full relative">
      
      {/* XP / LEVEL UP TOAST NOTIFICATION */}
      {xpToast && (
        <div className="fixed top-5 right-5 bg-gradient-to-r from-amber-500 to-amber-600 text-white font-extrabold text-xs px-5 py-3 rounded-2xl shadow-2xl z-50 animate-bounce flex items-center space-x-2 border border-amber-300">
          <span>🌟</span>
          <span>{xpToast}</span>
        </div>
      )}

      {/* GEMINI AI COACH RESPONSE MODAL */}
      {aiModalContent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200/80 space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <span className="text-xl">✨</span>
                <h3 className="text-lg font-black text-purple-900">
                  Gemini AI Coach Feedback ({aiModalContent.stageName})
                </h3>
              </div>
              <button
                onClick={() => setAiModalContent(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-purple-50/70 border border-purple-100 rounded-2xl p-4 text-xs leading-relaxed text-slate-700 font-medium whitespace-pre-wrap max-h-80 overflow-y-auto">
              {aiModalContent.feedbackText}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setAiModalContent(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GEMINI AI SPEECH SCORE & EVALUATION MODAL */}
      {aiScoreData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200/80 space-y-5">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <span className="text-2xl">📊</span>
                <h3 className="text-lg font-black text-blue-950">AI Speech Score & Feedback</h3>
              </div>
              <button
                onClick={() => setAiScoreData(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Score Banner & Outcome */}
            <div
              className={`p-5 rounded-2xl text-center border flex flex-col items-center justify-center space-y-1.5 ${
                aiScoreData.passed
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-amber-50 border-amber-200 text-amber-950'
              }`}
            >
              <div className="text-4xl font-black">
                {aiScoreData.score} / 10
              </div>
              <div className="text-xs font-black uppercase tracking-wider">
                {aiScoreData.passed
                  ? '🎉 Topic Passed & Completed!'
                  : '⚡ Score 5 or lower — Revision Needed!'}
              </div>
              <p className="text-[11px] font-medium text-slate-600 max-w-xs leading-relaxed">
                {aiScoreData.passed
                  ? aiScoreData.isAlreadyCompleted
                    ? 'You have already earned your +10 XP for completing this topic!'
                    : 'Great effort! You earned +10 XP for passing this topic!'
                  : 'To unlock your +10 XP and complete this topic, refine your points and score higher than 5.'}
              </p>
            </div>

            {/* Detailed Feedback Breakdown */}
            <div className="space-y-3 max-h-60 overflow-y-auto text-xs pr-1">
              {aiScoreData.strengths.length > 0 && (
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-1.5">
                  <span className="font-extrabold text-slate-800 flex items-center gap-1 text-[11px]">
                    💪 Key Strengths:
                  </span>
                  <ul className="list-disc list-inside space-y-1 text-slate-600">
                    {aiScoreData.strengths.map((str, idx) => (
                      <li key={idx}>{str}</li>
                    ))}
                  </ul>
                </div>
              )}

              {aiScoreData.improvements.length > 0 && (
                <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-1.5">
                  <span className="font-extrabold text-slate-800 flex items-center gap-1 text-[11px]">
                    🎯 Areas to Improve:
                  </span>
                  <ul className="list-disc list-inside space-y-1 text-slate-600">
                    {aiScoreData.improvements.map((imp, idx) => (
                      <li key={idx}>{imp}</li>
                    ))}
                  </ul>
                </div>
              )}

              {aiScoreData.summary && (
                <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3.5 text-slate-700 italic">
                  "{aiScoreData.summary}"
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setAiScoreData(null)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl shadow-md transition cursor-pointer"
              >
                Back to Practice ⚔️
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHARE TOPIC MODAL */}
      {shareModalTopic && (
        <ShareTopicModal
          topic={shareModalTopic}
          stance={chosenStance}
          session={session}
          ownerName={getHeroInfo(profile, session).name}
          onClose={() => setShareModalTopic(null)}
          onShared={() => {}}
        />
      )}

      {/* TOPIC PREP MODAL */}
      {selectedTopicModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200/80 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider bg-blue-100 text-blue-700">
                  {selectedTopicModal.category}
                </span>
                {renderTopicStatusBadge(selectedTopicModal.id)}
              </div>
              <button
                onClick={() => setSelectedTopicModal(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-sm p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div>
              <h3 className="text-xl font-black text-blue-950 leading-snug">
                {selectedTopicModal.title}
              </h3>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                {selectedTopicModal.description}
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 block">Select Your Side:</span>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    setChosenStance('Affirmative');
                    hydrateRebuttalPlanner(selectedTopicModal.id, 'Affirmative');
                  }}
                  className={`p-3 rounded-2xl border text-xs font-extrabold transition cursor-pointer flex flex-col items-center gap-1 ${
                    chosenStance === 'Affirmative'
                      ? 'border-blue-600 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-lg">👍</span>
                  <span>AFFIRMATIVE (FOR)</span>
                </button>
                <button
                  onClick={() => {
                    setChosenStance('Negative');
                    hydrateRebuttalPlanner(selectedTopicModal.id, 'Negative');
                  }}
                  className={`p-3 rounded-2xl border text-xs font-extrabold transition cursor-pointer flex flex-col items-center gap-1 ${
                    chosenStance === 'Negative'
                      ? 'border-amber-600 bg-amber-50 text-amber-800 ring-2 ring-amber-500/20'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-lg">👎</span>
                  <span>NEGATIVE (AGAINST)</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 text-xs text-slate-600 space-y-1">
              <span className="font-bold text-slate-800 block">💡 Prep Strategy:</span>
              <p>
                Use the <strong>PERIL Framework</strong> for your speech, then open the <strong>Rebuttal Planner</strong> to prepare counters to the other side.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => {
                  setActiveTab('hub');
                  setSelectedTopicModal(null);
                }}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Review Strategy
              </button>
              <button
                onClick={handleOpenRebuttalPlanner}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
              >
                Rebuttal Planner ⚡
              </button>
              <button
                onClick={handleBeginPractice}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
              >
                Begin Practice ⚔️
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-slate-200 bg-[#F7F9FC] p-5 flex flex-col justify-between shrink-0 hidden md:flex">
        <div className="space-y-6">
          <div className="flex items-center space-x-3 px-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">
              ⚔️
            </div>
            <h1 className="text-xl font-bold text-blue-900 tracking-tight">Debating Hero</h1>
          </div>

          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab('explorer')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-semibold text-xs transition cursor-pointer ${
                activeTab === 'explorer'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              <span className="text-base">🧭</span>
              <span>Topic Explorer</span>
            </button>
            <button
              onClick={() => setActiveTab('my-topics')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-semibold text-xs transition cursor-pointer ${
                activeTab === 'my-topics'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              <span className="text-base">✍️</span>
              <span>My Topics</span>
            </button>
            <button
              onClick={() => setActiveTab('hub')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-medium text-xs transition cursor-pointer ${
                activeTab === 'hub'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              <span className="text-base">🎓</span>
              <span>Learning Hub</span>
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl font-medium text-xs transition cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              <span className="text-base">🛡️</span>
              <span>Hero Profile</span>
            </button>
          </nav>
        </div>

        {/* User Sidebar Widget */}
        <div className="bg-white border border-slate-200/80 p-3.5 rounded-2xl flex items-center justify-between shadow-2xs">
          {session ? (() => {
            const { name, initial } = getHeroInfo(profile, session);
            return (
              <div
                onClick={() => setActiveTab('profile')}
                className="flex items-center space-x-3 cursor-pointer w-full"
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="Avatar" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center font-bold text-white text-xs shrink-0">
                    {initial}
                  </div>
                )}
                <div className="overflow-hidden">
                  <div className="text-xs font-bold text-slate-800 truncate">{name}</div>
                  <div className="text-[10px] text-slate-400 truncate">{getRankTitle(currentLevel)}</div>
                </div>
              </div>
            );
          })() : null}
        </div>
      </aside>

      {/* Main Full-Width Area */}
      <div className="flex-1 flex flex-col h-screen overflow-y-auto w-full pb-20 md:pb-0">
        {/* TOP HEADER WITH XP BAR AND DUOLINGO-STYLE STREAK COUNTER */}
        <header className="bg-white border-b border-slate-200/80 px-4 md:px-8 py-3 flex justify-between items-center shrink-0 w-full shadow-2xs relative gap-2">
          <div className="flex items-center space-x-3 md:space-x-5 min-w-0">
            
            {/* DUOLINGO DAILY STREAK FLAME WIDGET */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowStreakModal((prev) => !prev)}
                className={`flex items-center space-x-1.5 px-3 py-1 rounded-xl font-extrabold text-xs border transition cursor-pointer shadow-2xs ${
                  streakCount > 0
                    ? 'bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100'
                    : 'bg-slate-100 border-slate-200 text-slate-400 hover:bg-slate-200'
                }`}
              >
                <span className="text-base">🔥</span>
                <span>{streakCount} {streakCount === 1 ? 'Day' : 'Days'}</span>
              </button>

              {/* STREAK POPOVER CARD */}
              {showStreakModal && (
                <div className="absolute top-10 left-0 w-64 bg-white rounded-2xl p-4 shadow-xl border border-slate-200 z-50 animate-fadeIn space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-orange-600 flex items-center gap-1">
                      🔥 Daily Practice Streak
                    </span>
                    <button
                      onClick={() => setShowStreakModal(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {streakCount > 0
                      ? `Great job! You're on a ${streakCount}-day streak. Practice or save progress every day to keep your flame burning!`
                      : 'Complete any activity today (mark a topic or save a debate) to ignite your practice streak! 🔥'}
                  </p>
                </div>
              )}
            </div>

            {/* LEVEL & XP PROGRESS BAR */}
            <div className="flex items-center space-x-2 md:space-x-3 min-w-0">
              <span className="text-[10px] md:text-xs font-extrabold text-amber-500 uppercase tracking-wide shrink-0">
                HERO LEVEL {currentLevel}
              </span>
              <div className="w-20 sm:w-32 md:w-48 bg-slate-100 h-3 rounded-full overflow-hidden border border-slate-200/60">
                <div
                  className="bg-gradient-to-r from-amber-400 to-amber-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${(xpInCurrentLevel / XP_PER_LEVEL) * 100}%` }}
                ></div>
              </div>
              <span className="text-[10px] md:text-xs text-slate-500 font-mono font-bold shrink-0">
                {xpInCurrentLevel} / {XP_PER_LEVEL}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-1 md:space-x-3 shrink-0">
            {session && (() => {
              const { initial } = getHeroInfo(profile, session);
              return (
                <div 
                  onClick={() => setActiveTab('profile')}
                  className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center cursor-pointer hover:opacity-90 transition shadow-xs"
                >
                  {initial}
                </div>
              );
            })()}
          </div>
        </header>

        {/* PAGE 1: TOPIC EXPLORER */}
        {activeTab === 'explorer' && (
          <main className="p-8 w-full flex-1 space-y-6 pb-12">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-extrabold text-blue-950 tracking-tight">Topic Explorer</h2>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  Choose your battleground, Hero. Select from our library of topics to begin preparing.
                </p>
              </div>
              <span className="text-xs font-bold bg-blue-100 text-blue-700 px-3 py-1 rounded-full">
                {filteredTopics.length} Topics Found
              </span>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 w-full">
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'All Topics', icon: '' },
                  { label: '⏳ In Progress', icon: '' },
                  { label: 'Value & Ethics', icon: '⚖️' },
                  { label: 'Policy & Rules', icon: '📜' },
                  { label: 'Fact & Tech', icon: '🤖' },
                  { label: 'Preference & Fun', icon: '🎮' },
                  { label: 'Society & Culture', icon: '🌍' },
                ].map((cat) => (
                  <button
                    key={cat.label}
                    onClick={() => handleFilterChange(cat.label)}
                    className={`px-4 py-2 rounded-full text-xs font-semibold transition flex items-center space-x-1.5 cursor-pointer ${
                      selectedFilter === cat.label
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80 shadow-2xs'
                    }`}
                  >
                    {cat.icon && <span>{cat.icon}</span>}
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="flex items-center space-x-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <input
                    type="text"
                    placeholder="Search topics..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    className="w-full bg-slate-200/50 border border-slate-200 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Loading Spinner */}
            {loadingTopics ? (
              <div className="py-20 text-center space-y-3">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-xs text-slate-500 font-medium">Loading topics from Supabase...</p>
              </div>
            ) : filteredTopics.length === 0 ? (
              <div className="py-16 text-center bg-white rounded-3xl border border-slate-200/80 p-8">
                <p className="text-sm font-bold text-slate-700">No topics found matching your query.</p>
                <button
                  onClick={() => {
                    setSelectedFilter('All Topics');
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  className="mt-3 text-xs text-blue-600 font-bold hover:underline"
                >
                  Clear search filters
                </button>
              </div>
            ) : (
              <>
                {/* Topic Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
                  {paginatedTopics.map((topic) => (
                    <div
                      key={topic.id}
                      className={`rounded-2xl p-6 flex flex-col justify-between border transition shadow-2xs relative overflow-hidden ${
                        topic.is_featured
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-white border-slate-200/80 text-slate-800'
                      }`}
                    >
                      <div>
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider ${
                                topic.badge_bg || 'bg-blue-100 text-blue-700'
                              }`}
                            >
                              {topic.badge || topic.category}
                            </span>
                            {renderTopicStatusBadge(topic.id)}
                            {sharedTopicIds.has(topic.id) && (
                              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider bg-indigo-100 text-indigo-700">
                                Shared
                              </span>
                            )}
                          </div>
                          <span className="text-amber-400 text-xs tracking-widest">
                            {renderStars(topic.difficulty)}
                          </span>
                        </div>

                        <h3 className="text-lg font-bold leading-snug mb-2">{topic.title}</h3>
                        <p
                          className={`text-xs leading-relaxed ${
                            topic.is_featured ? 'text-blue-100' : 'text-slate-500'
                          }`}
                        >
                          {topic.description}
                        </p>
                      </div>

                      <div className="mt-6 flex justify-end items-center gap-2 pt-4 border-t border-slate-100">
                        <button
                          onClick={() => handleOpenShareModal(topic)}
                          className={`px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                            topic.is_featured
                              ? 'bg-white/15 text-white hover:bg-white/25'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          🔗 Share
                        </button>
                        <button
                          onClick={() => openTopicModal(topic)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                            topic.is_featured
                              ? 'bg-white text-blue-600 hover:bg-slate-100'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white'
                          }`}
                        >
                          {userDebatesMap[topic.id] ? 'Continue Practice' : 'Start Topic'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* PAGINATION CONTROLS */}
                {totalPages > 1 && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center pt-6 border-t border-slate-200/80">
                    <span className="text-xs text-slate-500 font-medium">
                      Showing <span className="font-bold text-slate-800">{startIndex + 1}</span> -{' '}
                      <span className="font-bold text-slate-800">
                        {Math.min(startIndex + ITEMS_PER_PAGE, filteredTopics.length)}
                      </span>{' '}
                      of <span className="font-bold text-slate-800">{filteredTopics.length}</span> topics
                    </span>

                    <div className="flex items-center flex-wrap gap-1.5">
                      <button
                        onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
                      >
                        ← Prev
                      </button>

                      {getCompactPageItems(currentPage, totalPages).map((item, index) =>
                        item === 'ellipsis' ? (
                          <span
                            key={`ellipsis-${index}`}
                            className="w-8 h-9 flex items-center justify-center text-xs font-bold text-slate-400"
                          >
                            …
                          </span>
                        ) : (
                          <button
                            key={item}
                            onClick={() => setCurrentPage(item)}
                            className={`w-9 h-9 rounded-xl text-xs font-bold transition cursor-pointer ${
                              currentPage === item
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                            }`}
                          >
                            {item}
                          </button>
                        )
                      )}

                      <button
                        onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
        )}

        {/* PAGE 1.2: MY TOPICS TAB */}
        {activeTab === 'my-topics' && (
          <main className="p-8 w-full flex-1 space-y-6 pb-12">
            <div className="flex justify-between items-end gap-4 flex-wrap">
              <div>
                <h2 className="text-3xl font-extrabold text-blue-950 tracking-tight">My Topics</h2>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  Your custom motions and shared team workspaces — all in one place.
                </p>
              </div>
              <span
                className={`text-xs font-bold px-3 py-1 rounded-full ${
                  myTopicsView === 'teamwork'
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-purple-100 text-purple-700'
                }`}
              >
                {myTopicsView === 'teamwork'
                  ? `${teamworkShares.length} Shared Topics`
                  : `${myTopics.length} Custom Topics`}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMyTopicsView('custom')}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition cursor-pointer ${
                  myTopicsView === 'custom'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                }`}
              >
                Custom Topics
              </button>
              <button
                type="button"
                onClick={() => setMyTopicsView('teamwork')}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition cursor-pointer ${
                  myTopicsView === 'teamwork'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                }`}
              >
                🤝 Teamwork
                {incomingShares.length > 0 ? ` (${incomingShares.length})` : ''}
              </button>
            </div>

            {myTopicsView === 'teamwork' ? (
              teamworkShares.length === 0 ? (
                <div className="py-16 text-center bg-white rounded-3xl border border-indigo-100 p-8 space-y-2">
                  <p className="text-sm font-bold text-indigo-900">No shared team topics yet</p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    When a teammate sends you an invite link, sign up, open the link, then find it here under My Topics → Teamwork.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
                  {teamworkShares.map((share) => (
                    <div
                      key={share.id}
                      className="bg-white border border-indigo-100 rounded-2xl p-6 flex flex-col justify-between shadow-2xs"
                    >
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider bg-indigo-100 text-indigo-700">
                            Teamwork
                          </span>
                          <span
                            className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider ${
                              share.permission === 'edit'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {share.permission === 'edit' ? 'Can edit' : 'View only'}
                          </span>
                          <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider bg-slate-100 text-slate-600">
                            {share.stance}
                          </span>
                        </div>
                        <h3 className="text-lg font-bold leading-snug text-slate-800">{share.topic_title}</h3>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Shared workspace for team prep
                          {share.permission === 'view'
                            ? ' — leave comments on each point.'
                            : ' — co-edit and save together.'}
                        </p>
                      </div>
                      <div className="mt-6 pt-4 border-t border-slate-100">
                        <button
                          onClick={() => openSharedWorkspace(share)}
                          className="w-full px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white"
                        >
                          Open shared topic
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <>
            {/* Creation Form Box */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
              <h3 className="text-sm font-extrabold text-slate-800">✍️ Create a New Topic</h3>
              <form onSubmit={handleCreateCustomTopic} className="space-y-3">
                <input
                  type="text"
                  placeholder="Enter motion... e.g. 'That primary school students should not be given homework'"
                  value={newTopicTitle}
                  onChange={(e) => setNewTopicTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  required
                />
                <textarea
                  rows={2}
                  placeholder="Optional context or description..."
                  value={newTopicDesc}
                  onChange={(e) => setNewTopicDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isCreatingTopic || !newTopicTitle.trim()}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
                  >
                    {isCreatingTopic ? 'Saving Topic...' : 'Add Custom Topic +'}
                  </button>
                </div>
              </form>
            </div>

            {/* Custom Topic Cards Grid */}
            {filteredMyTopics.length === 0 ? (
              <div className="py-16 text-center bg-white rounded-3xl border border-slate-200/80 p-8 space-y-2">
                <p className="text-sm font-bold text-slate-700">No custom topics created yet.</p>
                <p className="text-xs text-slate-400">Type a motion above to add your first debate topic!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
                {filteredMyTopics.map((topic) => (
                  <div
                    key={topic.id}
                    className="bg-white border-slate-200/80 text-slate-800 rounded-2xl p-6 flex flex-col justify-between border transition shadow-2xs relative overflow-hidden"
                  >
                    {editingTopicId === topic.id ? (
                      /* INLINE EDIT FORM */
                      <div className="space-y-3">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-md uppercase bg-amber-100 text-amber-800">
                            Editing
                          </span>
                        </div>
                        <input
                          type="text"
                          value={editTopicTitle}
                          onChange={(e) => setEditTopicTitle(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-500"
                        />
                        <textarea
                          rows={2}
                          value={editTopicDesc}
                          onChange={(e) => setEditTopicDesc(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs text-slate-600 focus:outline-none focus:border-blue-500"
                        />
                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            onClick={() => setEditingTopicId(null)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-lg transition cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(topic.id)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition cursor-pointer"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* CARD DISPLAY VIEW */
                      <>
                        <div>
                          <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider bg-purple-100 text-purple-700">
                                Custom
                              </span>
                              {renderTopicStatusBadge(topic.id)}
                            </div>
                            
                            <div className="flex items-center space-x-1">
                              <button
                                onClick={() => handleStartEdit(topic)}
                                title="Edit Topic"
                                className="p-1 text-slate-400 hover:text-blue-600 transition cursor-pointer text-xs"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => handleDeleteTopic(topic.id)}
                                title="Delete Topic"
                                className="p-1 text-slate-400 hover:text-rose-600 transition cursor-pointer text-xs"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>

                          <h3 className="text-lg font-bold leading-snug mb-2">{topic.title}</h3>
                          <p className="text-xs text-slate-500 leading-relaxed">
                            {topic.description}
                          </p>
                        </div>

                        <div className="mt-6 flex justify-end items-center gap-2 pt-4 border-t border-slate-100">
                          <button
                            onClick={() => handleOpenShareModal(topic)}
                            className="px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer bg-slate-100 text-slate-600 hover:bg-slate-200"
                          >
                            🔗 Share
                          </button>
                          <button
                            onClick={() => openTopicModal(topic)}
                            className="px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white"
                          >
                            {userDebatesMap[topic.id] ? 'Continue Practice' : 'Start Topic'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
              </>
            )}
          </main>
        )}

        {/* PAGE 1.5: PRACTICE ARENA */}
        {activeTab === 'arena' && activeTopic && (
          <main className="p-8 w-full flex-1 space-y-6 pb-12">
            
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
              <div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => {
                      if (collaboration) {
                        setMyTopicsView('teamwork');
                        setActiveTab('my-topics');
                      } else {
                        setActiveTab(activeTopic.category === 'Custom' ? 'my-topics' : 'explorer');
                      }
                    }}
                    className="text-xs bg-white/10 hover:bg-white/20 text-white font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    ← Back to {collaboration || activeTopic.category === 'Custom' ? 'My Topics' : 'Explorer'}
                  </button>
                  <span className="text-[10px] uppercase tracking-widest font-bold text-blue-200">
                    {chosenStance === 'Affirmative' ? '👍 Team Affirmative' : '👎 Team Negative'}
                  </span>
                  <button
                    onClick={handleOpenRebuttalPlanner}
                    className="text-xs bg-rose-500/90 hover:bg-rose-500 text-white font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    ⚡ Rebuttal Planner
                  </button>
                </div>
                <h2 className="text-2xl font-black mt-2">{activeTopic.title}</h2>
                {collaboration && (
                  <p className="text-xs text-blue-100 mt-1">
                    Shared workspace · {collaboration.permission === 'edit' ? 'Can edit & save' : 'View only · leave comments on each point'}
                  </p>
                )}
              </div>

              {/* ACTION BUTTONS: SAVE PROGRESS + COMPLETE TOPIC (AI SCORE > 5) */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  onClick={handleSaveSpeech}
                  disabled={isSaving || !hasUnsavedChanges || !canEditWorkspace}
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-extrabold transition shadow-md flex items-center space-x-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    saveStatus === 'saved'
                      ? 'bg-emerald-500 text-white'
                      : saveStatus === 'error'
                      ? 'bg-rose-500 text-white'
                      : 'bg-white text-blue-600 hover:bg-blue-50'
                  }`}
                >
                  <span>💾</span>
                  <span>
                    {isSaving
                      ? 'Saving...'
                      : saveStatus === 'saved'
                      ? '✓ Saved!'
                      : saveStatus === 'error'
                      ? 'Error Saving'
                      : !canEditWorkspace
                      ? 'View only'
                      : hasUnsavedChanges
                      ? 'Save Progress'
                      : 'Saved'}
                  </span>
                </button>

                <button
                  onClick={handleEvaluateFullSpeech}
                  disabled={loadingAiScore || !isSpeechFullyCompleted() || !canEditWorkspace}
                  className="px-4 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-900 font-extrabold text-xs rounded-xl shadow-md transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span>🏆</span>
                  <span>{loadingAiScore ? 'Judging Speech...' : 'Submit to AI Score (+10 XP)'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
              <div className="lg:col-span-2 space-y-4">
                {SPEECH_STAGE_CARDS.map((card) => (
                  <div
                    key={card.key}
                    onClick={() => setActiveStage(card.key)}
                    className={`bg-white rounded-2xl p-5 border transition shadow-2xs cursor-pointer ${
                      activeStage === card.key ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200/80'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center space-x-2">
                        <span className={`w-3 h-3 rounded-full ${card.color}`}></span>
                        <h4 className="text-sm font-bold text-slate-800">{card.title}</h4>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCallGeminiCoach(card.key, card.title);
                          }}
                          disabled={loadingAiStage === card.key}
                          className="bg-purple-50 hover:bg-purple-100 text-purple-700 text-[11px] font-extrabold px-3 py-1 rounded-lg border border-purple-200 transition flex items-center gap-1 cursor-pointer"
                        >
                          <span>✨</span>
                          <span>{loadingAiStage === card.key ? 'Gemini Coaching...' : 'AI Coach'}</span>
                        </button>

                        <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-md font-medium">
                          {card.time}
                        </span>
                      </div>
                    </div>

                    <textarea
                      rows={3}
                      value={speechInputs[card.key]}
                      onChange={(e) => {
                        if (!canEditWorkspace) return;
                        setSpeechInputs({ ...speechInputs, [card.key]: e.target.value });
                      }}
                      readOnly={!canEditWorkspace}
                      placeholder={card.placeholder}
                      className={`w-full bg-slate-50/70 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 leading-relaxed ${
                        !canEditWorkspace ? 'opacity-90 cursor-default' : ''
                      }`}
                    />
                    <PointComments
                      comments={pointComments.filter((c) => c.target_key === card.key)}
                      canComment={canCommentOnPoints}
                      onAddComment={(body) => handleAddPointComment(card.key, body)}
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-6">
                <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Completion Requirement</h4>
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md font-bold">
                      {isSpeechFullyCompleted() ? '✓ Ready for AI Score' : 'Incomplete'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Fill out all text fields, then click <strong>Submit to AI Score (+10 XP)</strong>. Score <strong>higher than 5/10</strong> to complete the topic and earn your XP!
                  </p>
                </div>

                <div className="bg-[#107C55] rounded-2xl p-6 text-white shadow-lg space-y-5">
                  <div className="flex items-center space-x-2">
                    <span className="text-xl">🛠️</span>
                    <h3 className="text-lg font-bold">Hero Tools</h3>
                  </div>

                  <p className="text-xs text-emerald-100 leading-relaxed">
                    Use the <strong>PERIL</strong> framework. Click any phrase to insert it into your active speech card!
                  </p>

                  {HERO_TOOL_GROUPS.map((group) => (
                    <div key={group.label} className="space-y-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-200">
                        {group.label}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {group.phrases.map((phrase) => (
                          <button
                            key={phrase}
                            onClick={() => insertHeroPhrase(phrase)}
                            className="bg-white/20 hover:bg-white hover:text-[#107C55] text-white px-3 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer"
                          >
                            {phrase}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </main>
        )}

        {/* PAGE: REBUTTAL PLANNER */}
        {activeTab === 'rebuttal-planner' && activeTopic && (
          <main className="p-8 w-full flex-1 space-y-6 pb-12">
            <div className="bg-gradient-to-r from-rose-600 to-rose-700 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      if (collaboration) {
                        setMyTopicsView('teamwork');
                        setActiveTab('my-topics');
                      } else {
                        setActiveTab(activeTopic.category === 'Custom' ? 'my-topics' : 'explorer');
                      }
                    }}
                    className="text-xs bg-white/10 hover:bg-white/20 text-white font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    ← Back to {collaboration || activeTopic.category === 'Custom' ? 'My Topics' : 'Explorer'}
                  </button>
                  <span className="text-[10px] uppercase tracking-widest font-bold text-rose-100">
                    {chosenStance === 'Affirmative' ? '👍 Team Affirmative' : '👎 Team Negative'}
                  </span>
                  <button
                    onClick={() => {
                      setActiveTab('arena');
                      setSaveStatus('');
                    }}
                    className="text-xs bg-white/15 hover:bg-white/25 text-white font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    ⚔️ Speech Arena
                  </button>
                </div>
                <h2 className="text-2xl font-black mt-2">{activeTopic.title}</h2>
                <p className="text-xs text-rose-100 mt-1">Rebuttal Planner — prepare counters before you speak</p>
              </div>

              <button
                onClick={handleSaveSpeech}
                disabled={isSaving || !hasUnsavedChanges || !canEditWorkspace}
                className={`px-3.5 py-2.5 rounded-xl text-xs font-extrabold transition shadow-md flex items-center space-x-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
                  saveStatus === 'saved'
                    ? 'bg-emerald-500 text-white'
                    : saveStatus === 'error'
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-rose-700 hover:bg-rose-50'
                }`}
              >
                <span>💾</span>
                <span>
                  {isSaving
                    ? 'Saving...'
                    : saveStatus === 'saved'
                    ? '✓ Saved!'
                    : saveStatus === 'error'
                    ? 'Error Saving'
                    : !canEditWorkspace
                    ? 'View only'
                    : hasUnsavedChanges
                    ? 'Save Progress'
                    : 'Saved'}
                </span>
              </button>
            </div>

            <div className="space-y-3 rounded-2xl border border-rose-100 bg-rose-50/40 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-rose-900">⚡ Rebuttal Planner</h3>
                  <p className="text-xs text-rose-800/80 mt-1 leading-relaxed max-w-2xl">
                    Write the points you expect to face, then plan your rebuttal next to each one. Click Save Progress to keep your work.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addRebuttalRow}
                  disabled={!canEditWorkspace}
                  className="shrink-0 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-extrabold transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  + Add Point
                </button>
              </div>

              <div className="space-y-3">
                {rebuttalPlanner.map((row, index) => (
                  <div
                    key={row.id}
                    className="bg-white border border-rose-100 rounded-2xl p-4 space-y-2 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-rose-500">
                        Pair {index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeRebuttalRow(row.id)}
                        className="text-[10px] font-bold text-slate-400 hover:text-rose-600 transition cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                          Their Point
                        </label>
                        <textarea
                          rows={4}
                          value={row.point}
                          onChange={(e) => {
                            if (!canEditWorkspace) return;
                            updateRebuttalRow(row.id, 'point', e.target.value);
                          }}
                          readOnly={!canEditWorkspace}
                          placeholder="What might the other side argue?"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 focus:outline-none focus:border-rose-400 leading-relaxed resize-y"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                          Your Rebuttal
                        </label>
                        <textarea
                          rows={4}
                          value={row.rebuttal}
                          onChange={(e) => {
                            if (!canEditWorkspace) return;
                            updateRebuttalRow(row.id, 'rebuttal', e.target.value);
                          }}
                          readOnly={!canEditWorkspace}
                          placeholder="How will you counter it?"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 focus:outline-none focus:border-rose-400 leading-relaxed resize-y"
                        />
                      </div>
                    </div>
                    <PointComments
                      comments={pointComments.filter((c) => c.target_key === `rebuttal:${row.id}`)}
                      canComment={canCommentOnPoints}
                      onAddComment={(body) => handleAddPointComment(`rebuttal:${row.id}`, body)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </main>
        )}

        {/* PAGE 2: LEARNING HUB */}
        {activeTab === 'hub' && (
          <main className="p-8 w-full flex-1 space-y-8 pb-12">
            <div>
              <h2 className="text-3xl font-extrabold text-blue-950 tracking-tight">Learning Hub</h2>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                Master the core skills of debating: speech structure, devastating rebuttals, signposting, and essential world knowledge.
              </p>
            </div>

            {copiedPhrase && (
              <div className="fixed bottom-6 right-6 bg-emerald-600 text-white font-bold text-xs px-4 py-3 rounded-2xl shadow-xl z-50 animate-bounce">
                ✓ Copied "{copiedPhrase}" to clipboard!
              </div>
            )}

            <div className="flex border-b border-slate-200 gap-6 overflow-x-auto">
              {[
                { id: 'peril', label: '1. The PERIL Framework', icon: '🏗️' },
                { id: 'rebuttal', label: '2. Rebuttal Tactics', icon: '⚡' },
                { id: 'signposts', label: '3. Signposting Cheat Sheet', icon: '🛠️' },
                { id: 'humanities', label: '4. Humanities Knowledge', icon: '🏛️' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveLesson(tab.id)}
                  className={`pb-3 text-xs font-extrabold flex items-center space-x-2 border-b-2 transition cursor-pointer shrink-0 ${
                    activeLesson === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* LESSON 1: PERIL FRAMEWORK */}
            {activeLesson === 'peril' && (
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-6 text-white shadow-md">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-blue-200">Building Strong Arguments</span>
                  <h3 className="text-xl font-black mt-1">The P.E.R.I.L. Formula</h3>
                  <p className="text-xs text-blue-100 mt-1 leading-relaxed max-w-2xl">
                    Every winning point in a debate follows this simple 5-step structure. Never make a point without backing it up and linking it back!
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                  {[
                    {
                      step: 'P',
                      title: 'Point',
                      badge: 'bg-blue-100 text-blue-700',
                      desc: 'State your argument clearly in one simple sentence.',
                      example: '"School uniforms promote equality among students."',
                    },
                    {
                      step: 'E',
                      title: 'Explain',
                      badge: 'bg-cyan-100 text-cyan-800',
                      desc: 'Clarify what your point means so everyone understands it.',
                      example: '"This means students are judged less on what they wear and more on who they are."',
                    },
                    {
                      step: 'R',
                      title: 'Reasoning',
                      badge: 'bg-emerald-100 text-emerald-700',
                      desc: 'Explain WHY your point is true with clear logic.',
                      example: '"Because when everyone wears the same clothes, brand competition disappears."',
                    },
                    {
                      step: 'I',
                      title: 'Impact',
                      badge: 'bg-amber-100 text-amber-800',
                      desc: 'Show why this point matters and what result it creates.',
                      example: '"This reduces peer pressure and helps students focus more on learning."',
                    },
                    {
                      step: 'L',
                      title: 'Linking',
                      badge: 'bg-purple-100 text-purple-700',
                      desc: 'Link the point back to the topic and your overall case.',
                      example: '"Therefore, uniforms support a fairer school environment—and that proves our side."',
                    },
                  ].map((card) => (
                    <div key={card.step} className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-800 font-black text-sm flex items-center justify-center">
                          {card.step}
                        </span>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md ${card.badge}`}>
                          Step {card.step}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-800">{card.title}</h4>
                      <p className="text-xs text-slate-500 leading-relaxed">{card.desc}</p>
                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-[11px] italic text-slate-600">
                        {card.example}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* LESSON 2: REBUTTAL TACTICS */}
            {activeLesson === 'rebuttal' && (
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-amber-500 to-amber-600 rounded-3xl p-6 text-white shadow-md">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-amber-100">Defense & Counter-Attack</span>
                  <h3 className="text-xl font-black mt-1">The 4-Step Rebuttal Method</h3>
                  <p className="text-xs text-amber-50 mt-1 leading-relaxed max-w-2xl">
                    Don't just disagree—dismantle! Use this 4-step technique to systematically challenge your opponent's points.
                  </p>
                </div>

                <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-sm space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-1">
                      <span className="text-[10px] font-bold uppercase text-slate-400">1. They Said</span>
                      <h4 className="text-xs font-bold text-slate-800">Summarize Their Point</h4>
                      <p className="text-xs text-slate-500 italic">"The opposing team claimed that homework builds self-discipline..."</p>
                    </div>

                    <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-1">
                      <span className="text-[10px] font-bold uppercase text-rose-500">2. But...</span>
                      <h4 className="text-xs font-bold text-slate-800">State Your Refutation</h4>
                      <p className="text-xs text-slate-500 italic">"...however, this assumption is flawed because excessive work causes burnout."</p>
                    </div>

                    <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-1">
                      <span className="text-[10px] font-bold uppercase text-blue-500">3. Because...</span>
                      <h4 className="text-xs font-bold text-slate-800">Provide Your Reasoning</h4>
                      <p className="text-xs text-slate-500 italic">"...because exhaustion actually lowers retention rates and increases student anxiety."</p>
                    </div>

                    <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-1">
                      <span className="text-[10px] font-bold uppercase text-emerald-600">4. Therefore...</span>
                      <h4 className="text-xs font-bold text-slate-800">Conclude Your Impact</h4>
                      <p className="text-xs text-slate-500 italic">"...therefore, quality classroom time is far more valuable than hours of repetitive homework."</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* LESSON 3: SIGNPOSTING CHEAT SHEET */}
            {activeLesson === 'signposts' && (
              <div className="space-y-6">
                <div className="bg-[#107C55] rounded-3xl p-6 text-white shadow-md">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-emerald-200">Hero Signposts</span>
                  <h3 className="text-xl font-black mt-1">Signposting Phrases Library</h3>
                  <p className="text-xs text-emerald-100 mt-1 leading-relaxed max-w-2xl">
                    Signposts tell the adjudicator and audience where your speech is going. Click any phrase below to copy it!
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    {
                      category: 'Starting & Structuring',
                      color: 'border-l-4 border-blue-500',
                      phrases: [
                        'Our team will prove today that...',
                        'Firstly, I will address the principle of...',
                        'We base our case on three key pillars...',
                      ],
                    },
                    {
                      category: 'Linking & Expanding Ideas',
                      color: 'border-l-4 border-emerald-500',
                      phrases: [
                        'Furthermore, we must consider the long-term impact on...',
                        'This leads directly to my second argument regarding...',
                        'To build upon this point...',
                      ],
                    },
                    {
                      category: 'Countering & Rebutting',
                      color: 'border-l-4 border-rose-500',
                      phrases: [
                        'While the opposition claims that..., they overlook...',
                        'On the contrary, the real issue at hand is...',
                        'Even if we accept their premise, the outcome remains...',
                      ],
                    },
                    {
                      category: 'Summarizing & Closing',
                      color: 'border-l-4 border-amber-500',
                      phrases: [
                        'In conclusion, the facts clearly demonstrate that...',
                        'To summarize our winning arguments today...',
                        'For all these reasons, we proudly urge you to affirm...',
                      ],
                    },
                  ].map((group) => (
                    <div key={group.category} className={`bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs space-y-3 ${group.color}`}>
                      <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider">{group.category}</h4>
                      <div className="space-y-2">
                        {group.phrases.map((phrase) => (
                          <div
                            key={phrase}
                            onClick={() => handleCopyPhrase(phrase)}
                            className="bg-slate-50 hover:bg-slate-100 border border-slate-200/60 rounded-xl p-3 text-xs font-medium text-slate-700 flex justify-between items-center cursor-pointer transition"
                          >
                            <span>"{phrase}"</span>
                            <span className="text-[10px] bg-white border border-slate-200 px-2 py-1 rounded-md font-bold text-slate-500 shadow-2xs">
                              Copy
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* LESSON 4: DYNAMIC HUMANITIES KNOWLEDGE */}
            {activeLesson === 'humanities' && (
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-purple-700 to-indigo-800 rounded-3xl p-6 text-white shadow-md flex justify-between items-center">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest font-bold text-purple-200">World Knowledge Base</span>
                    <h3 className="text-xl font-black mt-1">Humanities & Social Science Fundamentals</h3>
                    <p className="text-xs text-purple-100 mt-1 leading-relaxed max-w-2xl">
                      Ground your arguments in real-world knowledge. Mark topics as "I Know" when you've mastered them!
                    </p>
                  </div>
                  {knownItems.size > 0 && (
                    <div className="bg-emerald-500/30 border border-emerald-400 text-emerald-100 px-4 py-2 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shrink-0">
                      <span>✓</span>
                      <span>{knownItems.size} Mastered</span>
                    </div>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex flex-wrap gap-2">
                  {['All', 'Political', 'History', 'Economics', 'Health'].map((filterType) => (
                    <button
                      key={filterType}
                      onClick={() => handleHumanitiesFilterChange(filterType)}
                      className={`px-4 py-2 rounded-full text-xs font-semibold transition cursor-pointer ${
                        selectedHumanitiesFilter === filterType
                          ? 'bg-purple-700 text-white shadow-md shadow-purple-500/20'
                          : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                      }`}
                    >
                      {filterType === 'Political' ? '🏛️ ' : filterType === 'History' ? '📜 ' : filterType === 'Economics' ? '📈 ' : filterType === 'Health' ? '🩺 ' : ''}
                      {filterType}
                    </button>
                  ))}
                </div>

                {/* Data Grid */}
                {loadingHumanities ? (
                  <div className="py-20 text-center space-y-3">
                    <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="text-xs text-slate-500 font-medium">Loading knowledge cards from database...</p>
                  </div>
                ) : filteredHumanities.length === 0 ? (
                  <div className="py-16 text-center bg-white rounded-3xl border border-slate-200/80 p-8">
                    <p className="text-sm font-bold text-slate-700">No knowledge entries found in the database.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {paginatedHumanities.map((item) => {
                        const isKnown = knownItems.has(item.id);
                        const typeConfig = {
                          Political: {
                            badge: 'bg-indigo-100 text-indigo-700 border-indigo-500',
                            icon: '🏛️',
                            bgSignpost: 'bg-indigo-900',
                          },
                          History: {
                            badge: 'bg-amber-100 text-amber-800 border-amber-500',
                            icon: '📜',
                            bgSignpost: 'bg-amber-950',
                          },
                          Economics: {
                            badge: 'bg-emerald-100 text-emerald-800 border-emerald-500',
                            icon: '📈',
                            bgSignpost: 'bg-emerald-900',
                          },
                          Health: {
                            badge: 'bg-rose-100 text-rose-800 border-rose-500',
                            icon: '🩺',
                            bgSignpost: 'bg-rose-950',
                          },
                        }[item.type] || {
                          badge: 'bg-slate-100 text-slate-700 border-slate-400',
                          icon: '🌐',
                          bgSignpost: 'bg-slate-900',
                        };

                        return (
                          <div
                            key={item.id}
                            className={`bg-white rounded-2xl p-6 border transition shadow-2xs space-y-4 border-l-4 ${typeConfig.badge.split(' ')[2]} ${
                              isKnown ? 'ring-2 ring-emerald-500/30 bg-emerald-50/10' : ''
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-xl">{typeConfig.icon}</span>
                                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-md uppercase tracking-wider ${typeConfig.badge.split(' ').slice(0, 2).join(' ')}`}>
                                  {item.type}
                                </span>
                              </div>

                              {/* PERSISTENT I KNOW BUTTON */}
                              <button
                                onClick={() => toggleKnowItem(item.id)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border ${
                                  isKnown
                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
                                }`}
                              >
                                <span>{isKnown ? '✓' : '💡'}</span>
                                <span>{isKnown ? 'Mastered' : 'I Know'}</span>
                              </button>
                            </div>

                            <div>
                              <h4 className="text-base font-bold text-slate-800">{item.title}</h4>
                              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.content}</p>
                            </div>

                            {item.case_study && (
                              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-[11px] text-slate-700 space-y-1">
                                <span className="font-bold block text-slate-900">💡 Real-World Case Study:</span>
                                <p className="text-slate-600">{item.case_study}</p>
                              </div>
                            )}

                            {item.signpost_phrase && (
                              <div
                                onClick={() => handleCopyPhrase(item.signpost_phrase)}
                                className={`p-3 ${typeConfig.bgSignpost} text-white rounded-xl text-[11px] font-medium space-y-1 cursor-pointer hover:opacity-90 transition`}
                              >
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] font-bold uppercase text-slate-300">Copyable Signpost Phrase:</span>
                                  <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded text-white font-bold">Copy</span>
                                </div>
                                <p className="italic">"{item.signpost_phrase}"</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* HUMANITIES PAGINATION CONTROLS */}
                    {totalHumanitiesPages > 1 && (
                      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center pt-6 border-t border-slate-200/80">
                        <span className="text-xs text-slate-500 font-medium">
                          Showing <span className="font-bold text-slate-800">{humanitiesStartIndex + 1}</span> -{' '}
                          <span className="font-bold text-slate-800">
                            {Math.min(humanitiesStartIndex + HUMANITIES_PER_PAGE, filteredHumanities.length)}
                          </span>{' '}
                          of <span className="font-bold text-slate-800">{filteredHumanities.length}</span> knowledge topics
                        </span>

                        <div className="flex items-center flex-wrap gap-1.5">
                          <button
                            onClick={() => setHumanitiesPage((prev) => Math.max(prev - 1, 1))}
                            disabled={humanitiesPage === 1}
                            className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
                          >
                            ← Prev
                          </button>

                          {getCompactPageItems(humanitiesPage, totalHumanitiesPages).map((item, index) =>
                            item === 'ellipsis' ? (
                              <span
                                key={`ellipsis-${index}`}
                                className="w-8 h-9 flex items-center justify-center text-xs font-bold text-slate-400"
                              >
                                …
                              </span>
                            ) : (
                              <button
                                key={item}
                                onClick={() => setHumanitiesPage(item)}
                                className={`w-9 h-9 rounded-xl text-xs font-bold transition cursor-pointer ${
                                  humanitiesPage === item
                                    ? 'bg-purple-700 text-white shadow-md shadow-purple-500/20'
                                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                                }`}
                              >
                                {item}
                              </button>
                            )
                          )}

                          <button
                            onClick={() => setHumanitiesPage((prev) => Math.min(prev + 1, totalHumanitiesPages))}
                            disabled={humanitiesPage === totalHumanitiesPages}
                            className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
                          >
                            Next →
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </main>
        )}

        {/* PAGE 3: HERO PROFILE & AUTH SCREEN */}
        {activeTab === 'profile' && (
          <main className="p-8 w-full flex-1 flex justify-center items-center">
            {(() => {
              const { name } = getHeroInfo(profile, session);
              const displayName = nicknameDraft.trim() || name;

              return (
                <div className="w-full max-w-xl bg-white rounded-3xl p-8 border border-slate-200/80 shadow-md space-y-6">
                  <div className="flex justify-between items-center gap-3">
                    <div className="flex items-center space-x-4 min-w-0 flex-1">
                      {profile?.avatar_url ? (
                        <img
                          src={profile.avatar_url}
                          alt="Avatar"
                          className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-2xl shadow-md shrink-0">
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        {isEditingNickname ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={nicknameDraft}
                              autoFocus
                              onChange={(e) => {
                                setNicknameDraft(e.target.value);
                                if (nicknameStatus) setNicknameStatus('');
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveNickname();
                                if (e.key === 'Escape') handleCancelNicknameEdit();
                              }}
                              maxLength={40}
                              className="min-w-0 flex-1 bg-slate-50 border border-blue-300 rounded-xl px-3 py-1.5 text-lg font-extrabold text-blue-950 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                            />
                            <button
                              onClick={handleSaveNickname}
                              disabled={isSavingNickname || !nicknameDraft.trim()}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-extrabold rounded-lg transition cursor-pointer disabled:opacity-40"
                            >
                              {isSavingNickname ? '...' : 'Save'}
                            </button>
                            <button
                              onClick={handleCancelNicknameEdit}
                              disabled={isSavingNickname}
                              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-bold rounded-lg transition cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 min-w-0">
                            <h2 className="text-xl font-extrabold text-blue-950 truncate">
                              {displayName}
                            </h2>
                            <button
                              onClick={() => {
                                setNicknameDraft(profile?.username || name || '');
                                setIsEditingNickname(true);
                                setNicknameStatus('');
                              }}
                              title="Edit nickname"
                              className="shrink-0 p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition cursor-pointer text-xs"
                            >
                              ✏️
                            </button>
                            {nicknameStatus === 'saved' && (
                              <span className="text-[10px] font-bold text-emerald-600 shrink-0">Saved</span>
                            )}
                          </div>
                        )}
                        <span className="text-xs bg-amber-100 text-amber-800 font-bold px-3 py-0.5 rounded-full inline-block mt-1">
                          {getRankTitle(currentLevel)}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => supabase.auth.signOut()}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl transition cursor-pointer shrink-0"
                    >
                      Sign Out
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 text-center">
                      <span className="text-2xl block">🔥</span>
                      <span className="text-lg font-black text-orange-600 block">{streakCount} Days</span>
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Current Streak</span>
                    </div>

                    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-center">
                      <span className="text-2xl block">🏆</span>
                      <span className="text-lg font-black text-blue-600 block">{currentXp} XP</span>
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Total Experience</span>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-3">
                    <div className="flex justify-between text-xs font-bold text-slate-700">
                      <span>Hero Level {currentLevel}</span>
                      <span className="font-mono text-slate-500">{currentXp} Total XP ({xpInCurrentLevel} / {XP_PER_LEVEL} to Level {currentLevel + 1})</span>
                    </div>
                    <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden">
                      <div
                        className="bg-amber-400 h-full rounded-full transition-all duration-500"
                        style={{ width: `${(xpInCurrentLevel / XP_PER_LEVEL) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </main>
        )}
      </div>

      {/* Mobile bottom navigation (sidebar is hidden below md) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(15,23,42,0.06)]">
        <div className="flex items-stretch justify-around gap-0.5">
          {[
            { id: 'explorer', label: 'Explorer', icon: '🧭' },
            { id: 'my-topics', label: 'My Topics', icon: '✍️' },
            { id: 'hub', label: 'Hub', icon: '🎓' },
            { id: 'profile', label: 'Profile', icon: '🛡️' },
          ].map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl text-[10px] font-bold transition cursor-pointer ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <span className="text-base leading-none">{item.icon}</span>
                <span className="leading-tight truncate max-w-full">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}