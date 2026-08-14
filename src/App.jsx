import React, { useState, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { supabase } from './supabaseClient';
import AuthModal from './components/AuthModal';

const ITEMS_PER_PAGE = 12;

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

export default function App() {
  const [activeTab, setActiveTab] = useState('explorer'); // 'explorer' | 'arena' | 'hub' | 'profile'
  const [selectedFilter, setSelectedFilter] = useState('All Topics');
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);

  // Database Topics State
  const [topics, setTopics] = useState([]);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [selectedTopicModal, setSelectedTopicModal] = useState(null); // Active Topic Modal
  const [activeTopic, setActiveTopic] = useState(null);               // Topic being practiced
  const [chosenStance, setChosenStance] = useState('Affirmative');     // 'Affirmative' | 'Negative'

  // Save State
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'

  // AI Feedback Modal / Loading State
  const [loadingAiStage, setLoadingAiStage] = useState(''); // Stores stage key currently calling AI
  const [aiModalContent, setAiModalContent] = useState(null); // { stageKey, stageName, feedbackText }

  // Arena Speech Input State
  const [speechInputs, setSpeechInputs] = useState({
    topicIntro: '',
    point1: '',
    point2: '',
    point3: '',
    conclusion: '',
    opening: '',
    rebuttal1: '',
    rebuttal2: '',
    closing: '',
  });
  const [activeStage, setActiveStage] = useState('');

  // Learning Hub State
  const [activeLesson, setActiveLesson] = useState('areo');
  const [copiedPhrase, setCopiedPhrase] = useState('');

  // Supabase Auth & Profile State
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);

  // Fetch Topics from Supabase DB
  useEffect(() => {
    fetchTopics();
  }, []);

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

  // Listen to Supabase Auth State Changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user);
      else setProfile(null);
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

  // Fetch Existing Draft for Active Topic & Stance
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
      } else {
        setSpeechInputs({
          topicIntro: '',
          point1: '',
          point2: '',
          point3: '',
          conclusion: '',
          opening: '',
          rebuttal1: '',
          rebuttal2: '',
          closing: '',
        });
      }
    } catch (err) {
      console.error('Error loading saved draft:', err.message);
    }
  };

  // Save Speech Inputs to Supabase
  const handleSaveSpeech = async () => {
    if (!session) {
      alert('Please sign in to save your progress!');
      setActiveTab('profile');
      return;
    }

    if (!activeTopic) return;

    try {
      setIsSaving(true);
      setSaveStatus('saving');

      const { error } = await supabase
        .from('user_debates')
        .upsert(
          {
            user_id: session.user.id,
            topic_id: activeTopic.id,
            stance: chosenStance,
            speech_data: speechInputs,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,topic_id,stance' }
        );

      if (error) throw error;

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2500);
    } catch (err) {
      console.error('Error saving speech:', err.message);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  // Call Gemini AI Coach using official @google/genai SDK
  const handleCallGeminiCoach = async (stageKey, stageName) => {
    if (!activeTopic) return;

    try {
      setLoadingAiStage(stageKey);

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

      if (!apiKey) {
        alert('Missing API Key! Make sure VITE_GEMINI_API_KEY is set in .env.local');
        return;
      }

      // Initialize Google Gen AI client with environment key
      const ai = new GoogleGenAI({ apiKey });

      const prompt = `You are an encouraging debating coach for kids aged 10-14.
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
        contents: prompt,
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

  // Handle Practice Session Launch
  const handleBeginPractice = () => {
    const topicToPractice = selectedTopicModal;
    setActiveTopic(topicToPractice);
    setSelectedTopicModal(null);
    setActiveTab('arena');
    setSaveStatus('');

    if (session && topicToPractice) {
      loadSavedDraft(topicToPractice.id, chosenStance, session.user.id);
    } else {
      setSpeechInputs({
        topicIntro: '',
        point1: '',
        point2: '',
        point3: '',
        conclusion: '',
        opening: '',
        rebuttal1: '',
        rebuttal2: '',
        closing: '',
      });
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

  // Filter topics based on Category and Search Query
  const filteredTopics = topics.filter((t) => {
    const matchesCategory = selectedFilter === 'All Topics' || t.category === selectedFilter;
    const matchesSearch =
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const totalPages = Math.ceil(filteredTopics.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedTopics = filteredTopics.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const renderStars = (count) => '★'.repeat(count || 1) + '☆'.repeat(3 - (count || 1));

  return (
    <div className="min-h-screen bg-[#F0F3F8] text-slate-800 flex font-sans w-full relative">
      
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

      {/* TOPIC PREP MODAL */}
      {selectedTopicModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200/80 space-y-5">
            <div className="flex justify-between items-start">
              <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider bg-blue-100 text-blue-700">
                {selectedTopicModal.category}
              </span>
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
                activeTab === 'explorer' || activeTab === 'arena'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              <span className="text-base">🧭</span>
              <span>Topic Explorer</span>
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
                  <div className="text-[10px] text-slate-400 truncate">{profile?.rank_title || 'Novice Debater'}</div>
                </div>
              </div>
            );
          })() : (
            <button
              onClick={() => setActiveTab('profile')}
              className="w-full py-2.5 bg-blue-600 text-white font-bold text-xs rounded-xl hover:bg-blue-700 transition cursor-pointer shadow-md shadow-blue-500/20"
            >
              Sign In / Sign Up
            </button>
          )}
        </div>
      </aside>

      {/* Main Full-Width Area */}
      <div className="flex-1 flex flex-col h-screen overflow-y-auto w-full">
        {/* Top Header */}
        <header className="bg-white border-b border-slate-200/80 px-8 py-3 flex justify-between items-center shrink-0 w-full shadow-2xs">
          <div className="flex items-center space-x-4">
            <span className="text-xs font-bold text-amber-500 uppercase tracking-wide">
              Hero Level {profile?.level || 1}
            </span>
            <div className="w-56 bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-400 to-amber-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(((profile?.xp || 0) % 1000) / 10, 100)}%` }}
              ></div>
            </div>
            <span className="text-xs text-slate-400 font-mono">{profile?.xp || 0} / 3,000 XP</span>
          </div>

          <div className="flex items-center space-x-3">
            {!session ? (
              <button
                onClick={() => setActiveTab('profile')}
                className="px-4 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Sign In
              </button>
            ) : (() => {
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
                        {/* Badge & Stars */}
                        <div className="flex justify-between items-center mb-3">
                          <span
                            className={`text-[10px] font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider ${
                              topic.badge_bg || 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {topic.badge || topic.category}
                          </span>
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

                      {/* Card Bottom Bar */}
                      <div className="mt-6 flex justify-end items-center pt-4 border-t border-slate-100">
                        <button
                          onClick={() => setSelectedTopicModal(topic)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                            topic.is_featured
                              ? 'bg-white text-blue-600 hover:bg-slate-100'
                              : 'bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white'
                          }`}
                        >
                          Start Topic
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
                        className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs"
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
                        className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs"
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

        {/* PAGE 1.5: PRACTICE ARENA WITH DIRECT GEMINI AI COACH */}
        {activeTab === 'arena' && activeTopic && (
          <main className="p-8 w-full flex-1 space-y-6 pb-12">
            
            {/* Top Quest Banner */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
              <div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setActiveTab('explorer')}
                    className="text-xs bg-white/10 hover:bg-white/20 text-white font-bold px-2.5 py-1 rounded-lg transition cursor-pointer"
                  >
                    ← Back to Explorer
                  </button>
                  <span className="text-[10px] uppercase tracking-widest font-bold text-blue-200">
                    {chosenStance === 'Affirmative' ? '👍 Team Affirmative' : '👎 Team Negative'}
                  </span>
                </div>
                <h2 className="text-2xl font-black mt-2">{activeTopic.title}</h2>
              </div>

              {/* Save & Action Bar */}
              <div className="flex items-center space-x-3 shrink-0">
                <button
                  onClick={handleSaveSpeech}
                  disabled={isSaving}
                  className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition shadow-md flex items-center space-x-1.5 cursor-pointer ${
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
                      : 'Save Progress'}
                  </span>
                </button>
              </div>
            </div>

            {/* Arena Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
              
              {/* Left Side: Speech Cards */}
              <div className="lg:col-span-2 space-y-4">
                
                {/* 1. AFFIRMATIVE TEMPLATE */}
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
                            {/* GEMINI AI COACH BUTTON */}
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
                  /* 2. NEGATIVE TEMPLATE */
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

              {/* Right Side: Hero Tools Panel */}
              <div className="space-y-6">
                
                {/* Save Status Box */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Storage Sync</h4>
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md font-bold">
                      {session ? 'Supabase Connected' : 'Guest Mode'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {session
                      ? 'Click "Save Progress" above to sync your arguments to your Hero Profile.'
                      : 'Sign in to automatically save your speeches to the cloud.'}
                  </p>
                </div>

                {/* Hero Tools Signposting Box */}
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
                Master the core skills of debating: speech structure, devastating rebuttals, and killer signposting.
              </p>
            </div>

            {copiedPhrase && (
              <div className="fixed bottom-6 right-6 bg-emerald-600 text-white font-bold text-xs px-4 py-3 rounded-2xl shadow-xl z-50 animate-bounce">
                ✓ Copied "{copiedPhrase}" to clipboard!
              </div>
            )}

            <div className="flex border-b border-slate-200 gap-6">
              {[
                { id: 'areo', label: '1. The AREO Framework', icon: '🏗️' },
                { id: 'rebuttal', label: '2. Rebuttal Tactics', icon: '⚡' },
                { id: 'signposts', label: '3. Signposting Cheat Sheet', icon: '🛠️' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveLesson(tab.id)}
                  className={`pb-3 text-xs font-extrabold flex items-center space-x-2 border-b-2 transition cursor-pointer ${
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
          </main>
        )}

        {/* PAGE 3: HERO PROFILE & AUTH SCREEN */}
        {activeTab === 'profile' && (
          <main className="p-8 w-full flex-1 flex justify-center items-center">
            {!session ? (
              <AuthModal onAuthSuccess={() => setActiveTab('explorer')} />
            ) : (() => {
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
                        <span className="text-xs bg-blue-100 text-blue-700 font-bold px-3 py-0.5 rounded-full inline-block mt-1">
                          {profile?.rank_title || 'Novice Debater'}
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

                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-3">
                    <div className="flex justify-between text-xs font-bold text-slate-700">
                      <span>Hero Level {profile?.level || 1}</span>
                      <span className="font-mono text-slate-400">{profile?.xp || 0} / 1,000 XP</span>
                    </div>
                    <div className="w-full bg-slate-200 h-3 rounded-full overflow-hidden">
                      <div
                        className="bg-amber-400 h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(((profile?.xp || 0) % 1000) / 10, 100)}%` }}
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