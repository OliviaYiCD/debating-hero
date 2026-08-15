import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { supabase } from './supabaseClient';
import AuthModal from './components/AuthModal';

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
  opening: '',
  rebuttal1: '',
  rebuttal2: '',
  closing: '',
};

export default function App() {
  const [activeTab, setActiveTab] = useState('explorer'); // 'explorer' | 'my-topics' | 'arena' | 'hub' | 'profile'
  const [selectedFilter, setSelectedFilter] = useState('All Topics');
  const [searchQuery, setSearchQuery] = useState('');

  // Topic Pagination State
  const [currentPage, setCurrentPage] = useState(1);

  // Database Topics & User Debates State
  const [topics, setTopics] = useState([]);
  const [myTopics, setMyTopics] = useState([]); // Custom User Topics
  const [userDebatesMap, setUserDebatesMap] = useState({}); // { [topicId_stance]: { speech_data, completed } }
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [selectedTopicModal, setSelectedTopicModal] = useState(null); // Active Topic Modal
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
  const [activeStage, setActiveStage] = useState('');

  // Learning Hub State
  const [activeLesson, setActiveLesson] = useState('areo');
  const [copiedPhrase, setCopiedPhrase] = useState('');

  // Supabase Auth & Profile State
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);

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
          debateMap[`${item.topic_id}_${item.stance}`] = item;
          // Also set generic topic_id key for card badges
          if (!debateMap[item.topic_id] || item.is_completed) {
            debateMap[item.topic_id] = item;
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
        awardUserXp(10);
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user);
        fetchMyTopics(session.user.id);
        fetchUserDebates(session.user.id);
        fetchUserHumanitiesProgress(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user);
        fetchMyTopics(session.user.id);
        fetchUserDebates(session.user.id);
        fetchUserHumanitiesProgress(session.user.id);
        setShowAuthModal(false);
      } else {
        setProfile(null);
        setMyTopics([]);
        setUserDebatesMap({});
        setKnownItems(new Set());
      }
    });

    return () => subscription.unsubscribe();
  }, []);

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
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
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
        awardUserXp(-10);
      } else {
        const { error } = await supabase
          .from('user_humanities_progress')
          .insert([{ user_id: session.user.id, humanities_id: itemId }]);

        if (error) throw error;
        awardUserXp(10);
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

  const loadSavedDraft = async (topicId, stance, userId) => {
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
        setSpeechInputs(data.speech_data);
        setInitialSpeechInputs(data.speech_data);
      } else {
        setSpeechInputs(DEFAULT_SPEECH);
        setInitialSpeechInputs(DEFAULT_SPEECH);
      }
    } catch (err) {
      console.error('Error loading saved draft:', err.message);
    }
  };

  // Check if topic draft has changes comparing to loaded version
  const hasUnsavedChanges = JSON.stringify(speechInputs) !== JSON.stringify(initialSpeechInputs);

  // Check if all fields for current stance are fully completed
  const isSpeechFullyCompleted = () => {
    const requiredKeys =
      chosenStance === 'Affirmative'
        ? ['topicIntro', 'point1', 'point2', 'point3', 'conclusion']
        : ['opening', 'rebuttal1', 'rebuttal2', 'closing'];

    return requiredKeys.every((key) => speechInputs[key] && speechInputs[key].trim().length > 0);
  };

  // Save Progress (NO XP awarded here - saves WIP status)
  const handleSaveSpeech = async () => {
    if (!session) {
      setShowAuthModal(true);
      return;
    }

    if (!activeTopic || !hasUnsavedChanges) return;

    try {
      setIsSaving(true);
      setSaveStatus('saving');

      const existingDebate = userDebatesMap[`${activeTopic.id}_${chosenStance}`];
      const currentCompleted = existingDebate?.is_completed || false;

      const { error } = await supabase
        .from('user_debates')
        .upsert(
          {
            user_id: session.user.id,
            topic_id: activeTopic.id,
            stance: chosenStance,
            speech_data: speechInputs,
            is_completed: currentCompleted,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,topic_id,stance' }
        );

      if (error) throw error;

      setSaveStatus('saved');
      setInitialSpeechInputs(speechInputs);
      
      // Update local state map
      setUserDebatesMap((prev) => ({
        ...prev,
        [`${activeTopic.id}_${chosenStance}`]: { speech_data: speechInputs, is_completed: currentCompleted },
        [activeTopic.id]: { speech_data: speechInputs, is_completed: currentCompleted },
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

    const speechText =
      chosenStance === 'Affirmative'
        ? `Intro: ${speechInputs.topicIntro}\nPoint 1: ${speechInputs.point1}\nPoint 2: ${speechInputs.point2}\nPoint 3: ${speechInputs.point3}\nConclusion: ${speechInputs.conclusion}`
        : `Opening: ${speechInputs.opening}\nRebuttal 1: ${speechInputs.rebuttal1}\nRebuttal 2: ${speechInputs.rebuttal2}\nClosing: ${speechInputs.closing}`;

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
          improvements: ['Work on expanding your reasons using the AREO formula.'],
          summary: 'A solid attempt at crafting your speech draft!',
        };
      }

      const numericScore = Number(parsedResult.score) || 0;
      const passedScoreThreshold = numericScore > 5;

      const existingDebate = userDebatesMap[`${activeTopic.id}_${chosenStance}`];
      const isAlreadyCompleted = existingDebate?.is_completed || false;

      // Update Supabase if score > 5
      if (passedScoreThreshold) {
        await supabase
          .from('user_debates')
          .upsert(
            {
              user_id: session.user.id,
              topic_id: activeTopic.id,
              stance: chosenStance,
              speech_data: speechInputs,
              is_completed: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,topic_id,stance' }
          );

        setUserDebatesMap((prev) => ({
          ...prev,
          [`${activeTopic.id}_${chosenStance}`]: { speech_data: speechInputs, is_completed: true },
          [activeTopic.id]: { speech_data: speechInputs, is_completed: true },
        }));

        if (!isAlreadyCompleted) {
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

    if (session && topicToPractice) {
      loadSavedDraft(topicToPractice.id, chosenStance, session.user.id);
    } else {
      setSpeechInputs(DEFAULT_SPEECH);
      setInitialSpeechInputs(DEFAULT_SPEECH);
    }

    setActiveStage(chosenStance === 'Affirmative' ? 'topicIntro' : 'opening');
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
    if (!activeStage) return;
    setSpeechInputs((prev) => ({
      ...prev,
      [activeStage]: prev[activeStage] ? prev[activeStage] + ' ' + phrase : phrase,
    }));
  };

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
      <div className="min-h-screen bg-[#F0F3F8] font-sans text-slate-800 flex flex-col justify-between">
        
        {/* AUTH MODAL POPUP */}
        {showAuthModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
            <div className="relative w-full max-w-md">
              <button
                onClick={() => setShowAuthModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold text-sm z-10 cursor-pointer"
              >
                ✕
              </button>
              <AuthModal onAuthSuccess={() => setShowAuthModal(false)} />
            </div>
          </div>
        )}

        {/* Landing Navbar */}
        <header className="bg-white border-b border-slate-200/80 px-8 py-4 flex justify-between items-center shadow-2xs">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg">
              ⚔️
            </div>
            <h1 className="text-xl font-extrabold text-blue-900 tracking-tight">Debating Hero</h1>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-xl transition shadow-md shadow-blue-500/20 cursor-pointer"
            >
              Sign In / Get Started
            </button>
          </div>
        </header>

        {/* Hero Section */}
        <main className="max-w-6xl mx-auto px-6 py-12 flex-1 flex flex-col justify-center space-y-12">
          
          <div className="text-center space-y-5 max-w-3xl mx-auto">
            <span className="text-xs font-black uppercase tracking-widest px-3.5 py-1.5 rounded-full bg-blue-100 text-blue-700">
              ⚔️ The Ultimate Debate Arena for Young Orators
            </span>
            <h2 className="text-4xl md:text-5xl font-black text-blue-950 leading-tight tracking-tight">
              Build Confidence, Master Rhetoric & Level Up Your Speech Skills!
            </h2>
            <p className="text-sm md:text-base text-slate-600 leading-relaxed font-medium">
              Explore debate motions, craft arguments using structured frameworks, practice in the Arena with an AI Speech Coach, and build daily practice streaks!
            </p>
            <div className="pt-2">
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold text-sm rounded-2xl shadow-xl shadow-blue-500/25 hover:scale-105 transition duration-200 cursor-pointer"
              >
                Join Debating Hero Today 🚀
              </button>
            </div>
          </div>

          {/* Feature Showcase Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
            
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center text-2xl font-bold">
                🧭
              </div>
              <h3 className="text-lg font-bold text-slate-800">100+ Debate Topics</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Browse through Value & Ethics, Policy, Fact & Tech, and Fun motions—or create your own custom topics!
              </p>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center text-2xl font-bold">
                ✨
              </div>
              <h3 className="text-lg font-bold text-slate-800">Gemini AI Coach</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Get instant, age-appropriate AI coaching feedback and speech scoring before speaking aloud.
              </p>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center text-2xl font-bold">
                🔥
              </div>
              <h3 className="text-lg font-bold text-slate-800">Leveling & Daily Streaks</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Earn XP for completing topics, unlock new debater ranks, and maintain your daily streak!
              </p>
            </div>

          </div>

          {/* CTA Banner */}
          <div className="bg-gradient-to-r from-blue-900 to-indigo-950 rounded-3xl p-8 text-white shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-1 text-center md:text-left">
              <h3 className="text-xl font-bold">Ready to make your voice heard?</h3>
              <p className="text-xs text-blue-200">Sign in or create your Hero profile in seconds.</p>
            </div>
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-6 py-3 bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-xs rounded-xl shadow-md transition cursor-pointer shrink-0"
            >
              Sign In / Register Now ⚔️
            </button>
          </div>

        </main>

        <footer className="text-center py-6 text-xs text-slate-400 border-t border-slate-200">
          © {new Date().getFullYear()} Debating Hero. Built for young debaters everywhere.
        </footer>
      </div>
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

      {/* TOPIC PREP MODAL */}
      {selectedTopicModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200/80 space-y-5">
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
                  onClick={() => setChosenStance('Affirmative')}
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
                  onClick={() => setChosenStance('Negative')}
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
                Use the <strong>AREO Framework</strong> (Assertion, Reason, Evidence, Outcome) from the Learning Hub to organize your thoughts before speaking.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
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
      <div className="flex-1 flex flex-col h-screen overflow-y-auto w-full">
        {/* TOP HEADER WITH XP BAR AND DUOLINGO-STYLE STREAK COUNTER */}
        <header className="bg-white border-b border-slate-200/80 px-8 py-3 flex justify-between items-center shrink-0 w-full shadow-2xs relative">
          <div className="flex items-center space-x-5">
            
            {/* DUOLINGO DAILY STREAK FLAME WIDGET */}
            <div className="relative">
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
            <div className="flex items-center space-x-3">
              <span className="text-xs font-extrabold text-amber-500 uppercase tracking-wide">
                HERO LEVEL {currentLevel}
              </span>
              <div className="w-48 bg-slate-100 h-3 rounded-full overflow-hidden border border-slate-200/60">
                <div
                  className="bg-gradient-to-r from-amber-400 to-amber-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${(xpInCurrentLevel / XP_PER_LEVEL) * 100}%` }}
                ></div>
              </div>
              <span className="text-xs text-slate-500 font-mono font-bold">
                {xpInCurrentLevel} / {XP_PER_LEVEL} XP
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
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
            <button className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer">🔔</button>
            <button className="p-2 text-slate-400 hover:text-slate-600 cursor-pointer">⚙️</button>
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

                      <div className="mt-6 flex justify-end items-center pt-4 border-t border-slate-100">
                        <button
                          onClick={() => setSelectedTopicModal(topic)}
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
                  <div className="flex justify-between items-center pt-6 border-t border-slate-200/80">
                    <span className="text-xs text-slate-500 font-medium">
                      Showing <span className="font-bold text-slate-800">{startIndex + 1}</span> -{' '}
                      <span className="font-bold text-slate-800">
                        {Math.min(startIndex + ITEMS_PER_PAGE, filteredTopics.length)}
                      </span>{' '}
                      of <span className="font-bold text-slate-800">{filteredTopics.length}</span> topics
                    </span>

                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
                      >
                        ← Prev
                      </button>

                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`w-9 h-9 rounded-xl text-xs font-bold transition cursor-pointer ${
                            currentPage === page
                              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                          }`}
                        >
                          {page}
                        </button>
                      ))}

                      <button
                        onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
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
            <div className="flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-extrabold text-blue-950 tracking-tight">My Custom Topics</h2>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  Create, edit, or delete your own debate motions and practice them in the Arena!
                </p>
              </div>
              <span className="text-xs font-bold bg-purple-100 text-purple-700 px-3 py-1 rounded-full">
                {myTopics.length} Custom Topics
              </span>
            </div>

            {/* Creation Form Box */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
              <h3 className="text-sm font-extrabold text-slate-800">✍️ Create a New Topic (+10 XP)</h3>
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

                        <div className="mt-6 flex justify-end items-center pt-4 border-t border-slate-100">
                          <button
                            onClick={() => setSelectedTopicModal(topic)}
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
          </main>
        )}

        {/* PAGE 1.5: PRACTICE ARENA */}
        {activeTab === 'arena' && activeTopic && (
          <main className="p-8 w-full flex-1 space-y-6 pb-12">
            
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
              <div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setActiveTab(activeTopic.category === 'Custom' ? 'my-topics' : 'explorer')}
                    className="text-xs bg-white/10 hover:bg-white/20 text-white font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    ← Back to {activeTopic.category === 'Custom' ? 'My Topics' : 'Explorer'}
                  </button>
                  <span className="text-[10px] uppercase tracking-widest font-bold text-blue-200">
                    {chosenStance === 'Affirmative' ? '👍 Team Affirmative' : '👎 Team Negative'}
                  </span>
                </div>
                <h2 className="text-2xl font-black mt-2">{activeTopic.title}</h2>
              </div>

              {/* ACTION BUTTONS: SAVE PROGRESS + COMPLETE TOPIC (AI SCORE > 5) */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  onClick={handleSaveSpeech}
                  disabled={isSaving || !hasUnsavedChanges}
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
                      : hasUnsavedChanges
                      ? 'Save Progress'
                      : 'Saved'}
                  </span>
                </button>

                <button
                  onClick={handleEvaluateFullSpeech}
                  disabled={loadingAiScore || !isSpeechFullyCompleted()}
                  className="px-4 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-900 font-extrabold text-xs rounded-xl shadow-md transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span>🏆</span>
                  <span>{loadingAiScore ? 'Judging Speech...' : 'Submit to AI Score (+10 XP)'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
              <div className="lg:col-span-2 space-y-4">
                {chosenStance === 'Affirmative' ? (
                  <>
                    {[
                      { key: 'topicIntro', title: 'Topic Introduction', time: '1.5 Mins', color: 'bg-blue-600', placeholder: 'Define the topic and introduce your main team stance...' },
                      { key: 'point1', title: 'POINT 1', time: '2 Mins', color: 'bg-blue-500', placeholder: 'State your first strongest argument using the AREO method...' },
                      { key: 'point2', title: 'POINT 2', time: '2 Mins', color: 'bg-blue-400', placeholder: 'State your second argument with supporting evidence...' },
                      { key: 'point3', title: 'POINT 3', time: '1.5 Mins', color: 'bg-blue-300', placeholder: 'State your final supporting argument...' },
                      { key: 'conclusion', title: 'Conclusion', time: '1 Min', color: 'bg-indigo-600', placeholder: 'Summarize your main points and deliver a powerful final statement...' },
                    ].map((card) => (
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
                          onChange={(e) => setSpeechInputs({ ...speechInputs, [card.key]: e.target.value })}
                          placeholder={card.placeholder}
                          className="w-full bg-slate-50/70 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 leading-relaxed"
                        />
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    {[
                      { key: 'opening', title: 'Opening Statement', time: '2 Mins', color: 'bg-blue-600', placeholder: "Type your heroic opening argument here... e.g., 'While the affirmative claims that..., we strongly oppose because...'" },
                      { key: 'rebuttal1', title: 'Rebuttal 1', time: '1.5 Mins', color: 'bg-slate-300', placeholder: "Awaiting opponent's argument to counter..." },
                      { key: 'rebuttal2', title: 'Rebuttal 2', time: '1.5 Mins', color: 'bg-slate-300', placeholder: "Awaiting opponent's argument to counter..." },
                      { key: 'closing', title: 'Closing Statement', time: '1 Min', color: 'bg-slate-300', placeholder: 'Summarize your winning points...' },
                    ].map((card) => (
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
                          onChange={(e) => setSpeechInputs({ ...speechInputs, [card.key]: e.target.value })}
                          placeholder={card.placeholder}
                          className="w-full bg-slate-50/70 border border-slate-200 rounded-xl p-3 text-xs text-slate-700 focus:outline-none focus:border-blue-500 leading-relaxed"
                        />
                      </div>
                    ))}
                  </>
                )}
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
                    Click any signposting phrase below to insert it directly into your active speech card!
                  </p>

                  <div className="space-y-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-200">Starting Strong</span>
                    <div className="flex flex-wrap gap-2">
                      {['Firstly...', 'My main point is...', 'Our team proves...'].map((phrase) => (
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

                  <div className="space-y-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-200">Connecting Ideas</span>
                    <div className="flex flex-wrap gap-2">
                      {['Furthermore...', 'This leads to...', 'Crucially...'].map((phrase) => (
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

                  <div className="space-y-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-200">Countering</span>
                    <div className="flex flex-wrap gap-2">
                      {['On the other hand...', 'While they claim...'].map((phrase) => (
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
                </div>
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
                { id: 'areo', label: '1. The AREO Framework', icon: '🏗️' },
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

            {/* LESSON 1: AREO FRAMEWORK */}
            {activeLesson === 'areo' && (
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-6 text-white shadow-md">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-blue-200">Building Strong Arguments</span>
                  <h3 className="text-xl font-black mt-1">The A.R.E.O. Formula</h3>
                  <p className="text-xs text-blue-100 mt-1 leading-relaxed max-w-2xl">
                    Every winning point in a debate follows this simple 4-step structure. Never make an assertion without backing it up!
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    {
                      step: 'A',
                      title: 'Assertion',
                      badge: 'bg-blue-100 text-blue-700',
                      desc: 'State your argument clearly in one simple sentence.',
                      example: '"School uniforms promote equality among students."',
                    },
                    {
                      step: 'R',
                      title: 'Reason',
                      badge: 'bg-emerald-100 text-emerald-700',
                      desc: 'Explain WHY your assertion is true.',
                      example: '"Because when everyone wears the same clothes, brand competition disappears."',
                    },
                    {
                      step: 'E',
                      title: 'Evidence',
                      badge: 'bg-amber-100 text-amber-800',
                      desc: 'Provide facts, statistics, or logical examples.',
                      example: '"Studies show 80% of students feel less peer pressure when wearing uniforms."',
                    },
                    {
                      step: 'O',
                      title: 'Outcome',
                      badge: 'bg-purple-100 text-purple-700',
                      desc: 'Explain why this point matters to the overall debate topic.',
                      example: '"Therefore, uniforms create a safer, more focused school environment."',
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

            {/* LESSON 4: DYNAMIC HUMANITIES KNOWLEDGE (+10 XP REWARD) */}
            {activeLesson === 'humanities' && (
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-purple-700 to-indigo-800 rounded-3xl p-6 text-white shadow-md flex justify-between items-center">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest font-bold text-purple-200">World Knowledge Base</span>
                    <h3 className="text-xl font-black mt-1">Humanities & Social Science Fundamentals</h3>
                    <p className="text-xs text-purple-100 mt-1 leading-relaxed max-w-2xl">
                      Ground your arguments in real-world knowledge. Mark topics as "I Know" to earn <strong>+10 XP</strong> each!
                    </p>
                  </div>
                  {knownItems.size > 0 && (
                    <div className="bg-emerald-500/30 border border-emerald-400 text-emerald-100 px-4 py-2 rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shrink-0">
                      <span>✓</span>
                      <span>{knownItems.size} Mastered (+{knownItems.size * 10} XP)</span>
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

                              {/* PERSISTENT I KNOW BUTTON WITH +10 XP */}
                              <button
                                onClick={() => toggleKnowItem(item.id)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border ${
                                  isKnown
                                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
                                }`}
                              >
                                <span>{isKnown ? '✓' : '💡'}</span>
                                <span>{isKnown ? 'Mastered (+10 XP)' : 'I Know (+10 XP)'}</span>
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
                      <div className="flex justify-between items-center pt-6 border-t border-slate-200/80">
                        <span className="text-xs text-slate-500 font-medium">
                          Showing <span className="font-bold text-slate-800">{humanitiesStartIndex + 1}</span> -{' '}
                          <span className="font-bold text-slate-800">
                            {Math.min(humanitiesStartIndex + HUMANITIES_PER_PAGE, filteredHumanities.length)}
                          </span>{' '}
                          of <span className="font-bold text-slate-800">{filteredHumanities.length}</span> knowledge topics
                        </span>

                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => setHumanitiesPage((prev) => Math.max(prev - 1, 1))}
                            disabled={humanitiesPage === 1}
                            className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
                          >
                            ← Prev
                          </button>

                          {Array.from({ length: totalHumanitiesPages }, (_, i) => i + 1).map((page) => (
                            <button
                              key={page}
                              onClick={() => setHumanitiesPage(page)}
                              className={`w-9 h-9 rounded-xl text-xs font-bold transition cursor-pointer ${
                                humanitiesPage === page
                                  ? 'bg-purple-700 text-white shadow-md shadow-purple-500/20'
                                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                              }`}
                            >
                              {page}
                            </button>
                          ))}

                          <button
                            onClick={() => setHumanitiesPage((prev) => Math.min(prev + 1, totalHumanitiesPages))}
                            disabled={humanitiesPage === totalHumanitiesPages}
                            className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
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
              const { name, initial } = getHeroInfo(profile, session);
              return (
                <div className="w-full max-w-xl bg-white rounded-3xl p-8 border border-slate-200/80 shadow-md space-y-6">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                      {profile?.avatar_url ? (
                        <img
                          src={profile.avatar_url}
                          alt="Avatar"
                          className="w-16 h-16 rounded-2xl object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-2xl shadow-md">
                          {initial}
                        </div>
                      )}
                      <div>
                        <h2 className="text-xl font-extrabold text-blue-950">{name}</h2>
                        <span className="text-xs bg-amber-100 text-amber-800 font-bold px-3 py-0.5 rounded-full inline-block mt-1">
                          {getRankTitle(currentLevel)}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => supabase.auth.signOut()}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl transition cursor-pointer"
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
    </div>
  );
}