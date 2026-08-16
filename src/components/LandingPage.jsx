import React from 'react';
import AuthModal from './AuthModal';
import { getPendingShareToken } from '../lib/sharing';

export default function LandingPage({ showAuthModal, onOpenAuth, onCloseAuth }) {
  const pendingInvite = Boolean(getPendingShareToken());

  return (
    <div className="landing-root min-h-screen font-sans text-slate-800 flex flex-col">
      {showAuthModal && (
        <div className="fixed inset-0 bg-slate-950/55 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="relative w-full max-w-md">
            <button
              onClick={onCloseAuth}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 font-bold text-sm z-10 cursor-pointer"
              aria-label="Close"
            >
              ✕
            </button>
            <AuthModal onAuthSuccess={onCloseAuth} />
          </div>
        </div>
      )}

      <header className="relative z-20 px-5 sm:px-8 py-5 flex justify-between items-center">
        <div className="hidden sm:flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-xl shadow-md shadow-blue-500/20">
            ⚔️
          </div>
          <span className="text-xl sm:text-2xl font-extrabold text-blue-900 tracking-tight">
            Debating Hero
          </span>
        </div>
        <div className="sm:hidden" aria-hidden="true" />
        <button
          onClick={onOpenAuth}
          className="px-4 sm:px-5 py-2.5 rounded-xl bg-white/80 hover:bg-white text-blue-600 border border-blue-100 font-bold text-xs transition cursor-pointer ml-auto sm:ml-0"
        >
          Sign in
        </button>
      </header>

      <main className="relative flex-1">
        {/* HERO — one composition */}
        <section className="landing-hero relative overflow-hidden pb-6 sm:pb-10">
          <div className="landing-hero-bg absolute inset-0" aria-hidden="true" />
          <div className="landing-hero-grid absolute inset-0" aria-hidden="true" />
          <div className="landing-orb landing-orb-a" aria-hidden="true" />
          <div className="landing-orb landing-orb-b" aria-hidden="true" />

          <div className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-4 sm:pt-8 pb-8 sm:pb-12 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-12 items-center">
            <div className="landing-hero-copy space-y-6 max-w-xl">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-2xl shadow-md shadow-blue-500/20">
                  ⚔️
                </div>
                <p className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-blue-950 tracking-tight">
                  Debating Hero
                </p>
              </div>
              <h1 className="text-2xl sm:text-3xl lg:text-[2.15rem] font-extrabold text-blue-950 leading-snug tracking-tight">
                {pendingInvite
                  ? 'You’ve been invited — join Debating Hero to open it'
                  : 'Train arguments. Share with your team. Win the rebuttal.'}
              </h1>
              <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-md">
                {pendingInvite
                  ? 'Create an account or sign in, then we’ll open the shared workspace for you.'
                  : 'A practice arena for young orators — structured speeches, live teamwork, and a Rebuttal Planner built for real rounds.'}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  onClick={onOpenAuth}
                  className="landing-cta px-7 py-3.5 rounded-2xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-white font-bold text-sm transition cursor-pointer"
                >
                  Join Debating Hero
                </button>
                <a
                  href="#teamwork"
                  className="px-5 py-3.5 rounded-2xl text-[#1D4ED8] font-bold text-sm hover:bg-blue-50/80 transition"
                >
                  See teamwork →
                </a>
              </div>
            </div>

            <div className="landing-stage relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden="true">
              <div className="landing-stage-panel">
                <div className="landing-stage-top">
                  <span className="landing-stage-dot" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-100/80">
                    Live practice floor
                  </span>
                </div>
                <div className="space-y-3">
                  <div className="landing-stage-line landing-stage-line-delay-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Motion</span>
                    <p className="text-sm sm:text-base font-semibold text-white leading-snug">
                      Is it ever okay to tell a white lie?
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="landing-stage-chip landing-stage-line-delay-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-sky-200">Teamwork</span>
                      <p className="text-xs text-white/90 mt-1 leading-relaxed">Share link · co-edit · comment</p>
                    </div>
                    <div className="landing-stage-chip landing-stage-line-delay-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-200">Rebuttal</span>
                      <p className="text-xs text-white/90 mt-1 leading-relaxed">Map clashes · plan replies</p>
                    </div>
                  </div>
                  <div className="landing-stage-meter landing-stage-line-delay-3">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-blue-100/70 mb-2">
                      <span>Speech coach</span>
                      <span>Ready</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="landing-meter-fill h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-300" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TEAMWORK */}
        <section id="teamwork" className="landing-section px-5 sm:px-8 py-12 sm:py-16">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <div className="space-y-4 max-w-lg">
              <p className="landing-kicker text-[#1D4ED8]">Teamwork</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-blue-950 tracking-tight leading-tight">
                Practice together like a debate squad
              </h2>
              <p className="text-slate-600 leading-relaxed text-[15px] sm:text-base">
                Share a topic with a link. Teammates sign up, open the workspace, and collaborate —
                view with comments, or co-edit the same speech draft.
              </p>
              <ul className="space-y-2.5 pt-2 text-sm text-slate-700">
                <li className="flex gap-3">
                  <span className="landing-check" />
                  Invite links — no messy email setup
                </li>
                <li className="flex gap-3">
                  <span className="landing-check" />
                  Find shared topics in the Teamwork module
                </li>
                <li className="flex gap-3">
                  <span className="landing-check" />
                  Point comments for focused feedback
                </li>
              </ul>
            </div>
            <div className="landing-visual-panel landing-visual-team">
              <div className="landing-fake-ui">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-bold text-blue-950">Shared workspace</span>
                  <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-indigo-100 text-indigo-700">
                    Can edit
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="h-3 rounded-md bg-slate-200/90 w-[80%]" />
                  <div className="h-3 rounded-md bg-slate-200/70 w-full" />
                  <div className="h-3 rounded-md bg-slate-200/70 w-[60%]" />
                </div>
                <div className="mt-5 flex -space-x-2">
                  {['A', 'B', 'C'].map((letter, i) => (
                    <div
                      key={letter}
                      className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-[11px] font-bold text-white"
                      style={{ background: ['#1D4ED8', '#0EA5E9', '#F59E0B'][i] }}
                    >
                      {letter}
                    </div>
                  ))}
                  <span className="ml-4 self-center text-xs font-semibold text-slate-500">3 heroes online</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* REBUTTAL */}
        <section id="rebuttal" className="landing-section landing-section-alt px-5 sm:px-8 py-12 sm:py-16">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <div className="order-2 lg:order-1 landing-visual-panel landing-visual-rebuttal">
              <div className="landing-fake-ui space-y-3">
                <p className="text-xs font-bold text-blue-950 mb-1">Rebuttal Planner</p>
                {[
                  { label: 'Their claim', note: 'White lies protect feelings' },
                  { label: 'Your clash', note: 'Trust erodes when truth is optional' },
                  { label: 'Reply line', note: 'Impact: long-term honesty wins' },
                ].map((row) => (
                  <div key={row.label} className="rounded-xl border border-slate-200/80 bg-white/80 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{row.label}</p>
                    <p className="text-sm font-semibold text-slate-800 mt-1">{row.note}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 lg:order-2 space-y-4 max-w-lg lg:justify-self-end">
              <p className="landing-kicker text-amber-700">Rebuttal Planner</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-blue-950 tracking-tight leading-tight">
                Turn their points into your winning replies
              </h2>
              <p className="text-slate-600 leading-relaxed text-[15px] sm:text-base">
                Map opponent arguments, build clash lines, and save a rebuttal plan alongside your speech —
                so you walk into the round ready, not scrambling.
              </p>
            </div>
          </div>
        </section>

        {/* ARENA + TOPICS */}
        <section className="landing-section px-5 sm:px-8 py-12 sm:py-16">
          <div className="max-w-6xl mx-auto space-y-8">
            <div className="max-w-2xl space-y-3">
              <p className="landing-kicker text-[#1D4ED8]">Arena & growth</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-blue-950 tracking-tight leading-tight">
                Structure, coach, and level up
              </h2>
              <p className="text-slate-600 leading-relaxed">
                Draft with PERIL frameworks, get Gemini coaching, and keep a daily streak as you climb ranks.
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-4 sm:gap-5">
              {[
                {
                  title: 'Topic Explorer',
                  body: '100+ motions across ethics, policy, tech, and culture — plus your own custom topics.',
                  accent: 'from-sky-500/15 to-transparent',
                },
                {
                  title: 'AI Speech Coach',
                  body: 'Instant, age-appropriate feedback and scoring before you speak aloud.',
                  accent: 'from-blue-600/15 to-transparent',
                },
                {
                  title: 'XP & streaks',
                  body: 'Earn XP for completed debates, unlock ranks, and stay consistent with daily practice.',
                  accent: 'from-amber-500/20 to-transparent',
                },
              ].map((item) => (
                <article
                  key={item.title}
                  className={`landing-feature-block rounded-3xl p-6 bg-gradient-to-b ${item.accent} border border-slate-200/70`}
                >
                  <h3 className="text-lg font-bold text-blue-950 mb-2">{item.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="px-5 sm:px-8 pb-14 pt-2">
          <div className="landing-final-cta max-w-6xl mx-auto rounded-[2rem] px-8 py-10 sm:px-12 sm:py-12 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div className="space-y-2 max-w-lg">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Ready for your next round?
              </h2>
              <p className="text-sm text-blue-100/85 leading-relaxed">
                {pendingInvite
                  ? 'Join Debating Hero to open your invite and start practicing with your team.'
                  : 'Create your profile in seconds and start building stronger speeches today.'}
              </p>
            </div>
            <button
              onClick={onOpenAuth}
              className="shrink-0 px-7 py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-[#0B1F4A] font-bold text-sm transition cursor-pointer"
            >
              Join Debating Hero
            </button>
          </div>
        </section>
      </main>

      <footer className="px-5 sm:px-8 py-8 text-center text-xs text-slate-500 border-t border-slate-200/80">
        © {new Date().getFullYear()} Debating Hero. Built for young debaters everywhere.
      </footer>
    </div>
  );
}
