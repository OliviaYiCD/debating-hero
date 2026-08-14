import React, { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function AuthModal({ onAuthSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) setErrorMsg(error.message);
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username: username || email.split('@')[0] },
          },
        });
        if (error) throw error;
        if (data?.user) {
          alert('Sign up successful! Please check your email for confirmation.');
          if (onAuthSuccess) onAuthSuccess(data.user);
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (data?.user && onAuthSuccess) {
          onAuthSuccess(data.user);
        }
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto bg-white rounded-3xl p-8 border border-slate-200/80 shadow-xl font-sans">
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-xl mx-auto mb-3 shadow-md shadow-blue-500/20">
          ⚔️
        </div>
        <h2 className="text-2xl font-black text-blue-950 tracking-tight">
          {isSignUp ? 'Become a Debating Hero' : 'Welcome Back, Hero!'}
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {isSignUp 
            ? 'Create an account to track your level, XP, and badges.' 
            : 'Sign in to jump straight back into the arena.'}
        </p>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl text-xs font-medium text-center">
          {errorMsg}
        </div>
      )}

      <button
        type="button"
        onClick={handleGoogleSignIn}
        className="w-full py-3 px-4 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl text-slate-700 font-bold text-xs flex items-center justify-center space-x-3 transition shadow-xs cursor-pointer mb-5"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span>Continue with Google</span>
      </button>

      <div className="relative flex py-2 items-center mb-5">
        <div className="flex-grow border-t border-slate-200"></div>
        <span className="flex-shrink mx-3 text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">
          Or with email
        </span>
        <div className="flex-grow border-t border-slate-200"></div>
      </div>

      <form onSubmit={handleEmailAuth} className="space-y-4">
        {isSignUp && (
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Hero Name / Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. MasterDebater"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-blue-500 focus:bg-white transition"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="hero@example.com"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-blue-500 focus:bg-white transition"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:outline-none focus:border-blue-500 focus:bg-white transition"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-2xl shadow-md shadow-blue-500/20 transition cursor-pointer disabled:opacity-50"
        >
          {loading ? 'Processing...' : isSignUp ? 'Create Hero Account' : 'Sign In'}
        </button>
      </form>

      <div className="mt-6 text-center pt-4 border-t border-slate-100">
        <p className="text-xs text-slate-500">
          {isSignUp ? 'Already a Hero?' : "Don't have an account yet?"}{' '}
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setErrorMsg('');
            }}
            className="text-blue-600 font-bold hover:underline cursor-pointer"
          >
            {isSignUp ? 'Sign In' : 'Sign Up Free'}
          </button>
        </p>
      </div>
    </div>
  );
}