// LandingPage.jsx — Premium marketing landing page
import React, { useState, useEffect, useRef } from 'react';

/* ── Tiny helpers ── */
const Gold  = '#d4af37';
const Gold2 = 'rgba(212,175,55,0.15)';
const Dark  = '#07091a';
const Card  = 'rgba(13,16,38,0.75)';

function useCountUp(target, duration = 1800, start = false) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime = null;
    const step = (ts) => {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setVal(Math.floor(ease * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [start, target, duration]);
  return val;
}

function useInView(ref) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setInView(true); },
      { threshold: 0.2 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref]);
  return inView;
}

/* ── Stat counter card ── */
function StatCard({ value, suffix, label, delay = 0 }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const count  = useCountUp(value, 1600, inView);
  return (
    <div ref={ref} className="lp-fade-up" style={{ animationDelay: `${delay}s`, textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: '2rem', fontWeight: 800, color: Gold, letterSpacing: '-0.5px' }}>
        {count.toLocaleString()}{suffix}
      </div>
      <div style={{ color: '#64748b', fontSize: '0.8rem', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '4px' }}>{label}</div>
    </div>
  );
}

/* ── Feature card ── */
function FeatureCard({ icon, title, body, delay = 0 }) {
  return (
    <div
      className="lp-card-hover lp-fade-up"
      style={{
        animationDelay: `${delay}s`,
        background: Card,
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: '16px',
        padding: '28px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ fontSize: '28px', lineHeight: 1 }}>{icon}</div>
      <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.95rem' }}>{title}</div>
      <div style={{ color: '#64748b', fontSize: '0.83rem', lineHeight: 1.7 }}>{body}</div>
    </div>
  );
}

/* ── Game card ── */
function GameCard({ icon, name, tag, desc, accent, delay = 0 }) {
  return (
    <div
      className="lp-card-hover lp-fade-up"
      style={{
        animationDelay: `${delay}s`,
        position: 'relative',
        flex: 1,
        minWidth: '220px',
        background: `linear-gradient(145deg, rgba(13,16,38,0.9) 0%, rgba(13,16,38,0.7) 100%)`,
        backdropFilter: 'blur(20px)',
        border: `1px solid ${accent}30`,
        borderRadius: '20px',
        padding: '32px 24px',
        overflow: 'hidden',
      }}
    >
      {/* Glow blob */}
      <div style={{
        position: 'absolute', top: '-40px', right: '-40px',
        width: '120px', height: '120px',
        borderRadius: '50%',
        background: accent,
        opacity: 0.08,
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />
      <div style={{ fontSize: '40px', marginBottom: '16px' }}>{icon}</div>
      <div style={{
        display: 'inline-block',
        padding: '2px 10px',
        background: `${accent}20`,
        border: `1px solid ${accent}40`,
        borderRadius: '20px',
        color: accent,
        fontSize: '11px',
        fontWeight: 700,
        letterSpacing: '1px',
        marginBottom: '12px',
      }}>{tag}</div>
      <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '1.1rem', marginBottom: '8px' }}>{name}</div>
      <div style={{ color: '#64748b', fontSize: '0.82rem', lineHeight: 1.7 }}>{desc}</div>
    </div>
  );
}

/* ── Step ── */
function Step({ number, title, body, delay = 0 }) {
  return (
    <div className="lp-fade-up" style={{ animationDelay: `${delay}s`, display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
      <div style={{
        flexShrink: 0,
        width: '44px', height: '44px',
        borderRadius: '12px',
        background: `linear-gradient(135deg, ${Gold} 0%, #b8941f 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: '1rem', color: '#000',
        boxShadow: `0 4px 20px rgba(212,175,55,0.3)`,
      }}>{number}</div>
      <div>
        <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.95rem', marginBottom: '6px' }}>{title}</div>
        <div style={{ color: '#64748b', fontSize: '0.83rem', lineHeight: 1.7 }}>{body}</div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
export default function LandingPage({ isMobile, joinCodeInput, setJoinCodeInput, handleJoinByCode, joinCodeLoading, resolveError, setResolveError, setAuthMode }) {

  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const features = [
    { icon: '📡', title: 'Real-Time Sync',       body: 'Firebase-powered live updates so every viewer sees bets and odds the instant they change — zero delay.' },
    { icon: '🏆', title: 'Live Leaderboard',      body: 'A competitive chip leaderboard updates every round so the whole chat is racing to the top.' },
    { icon: '🔗', title: 'Vanity Room Codes',     body: 'Share a custom room code on stream. Viewers join with one click — no link needed.' },
    { icon: '🎙️', title: 'Stream Overlay Ready',  body: 'Dedicated overlay mode shows the current game, odds, and top players directly on your broadcast.' },
    { icon: '🎬', title: 'VOD Replay Mode',       body: 'Record sessions as scripts so VOD viewers can play along and relive the action after the stream ends.' },
    { icon: '🛡️', title: 'No Real Money',         body: 'Pure virtual entertainment — no deposits, no wallet. Safe for every streamer and every viewer.' },
  ];

  const steps = [
    { title: 'Create your dealer account', body: 'Sign up as a streamer/dealer in seconds. No credit card required.' },
    { title: 'Start a session & go live',  body: 'Pick Roulette, Craps, or Baccarat. Share your room code in chat.' },
    { title: 'Viewers join and bet',        body: 'Players sign up, grab their virtual chips, and start betting each round in real time.' },
    { title: 'Crown the champion',          body: 'End the session to reveal the final leaderboard and celebrate the winner on stream.' },
  ];

  const games = [
    { icon: '🎡', name: 'Roulette',  tag: 'CLASSIC', desc: 'Inside, outside, and split bets with live spin animations synced to every viewer.',  accent: '#d4af37' },
    { icon: '🎲', name: 'Craps',     tag: 'SOCIAL',  desc: 'Pass, don\'t pass, come bets and the full odds market — the most social table game.',   accent: '#22c55e' },
    { icon: '🃏', name: 'Baccarat',  tag: 'FAST',    desc: 'Banker, player, tie — ultra-fast rounds that keep stream energy at its peak.',           accent: '#818cf8' },
  ];

  return (
    <div className="lp-root" style={{ minHeight: '100vh', background: Dark, color: '#e2e8f0', overflowX: 'hidden' }}>

      {/* ── Ambient background blobs ── */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-10%', left: '-5%',   width: '60vw', height: '60vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(212,175,55,0.06) 0%, transparent 70%)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '-10%', width: '50vw', height: '50vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(129,140,248,0.05) 0%, transparent 70%)', filter: 'blur(80px)' }} />
        <div style={{ position: 'absolute', top: '50%',  left: '30%',   width: '40vw', height: '40vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,197,94,0.03) 0%, transparent 70%)',  filter: 'blur(80px)' }} />
      </div>

      {/* ═══════════════════════════════ NAVBAR ═══════════════════════════════ */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '14px 20px' : '16px 48px',
        background: navScrolled ? 'rgba(7,9,26,0.9)' : 'transparent',
        backdropFilter: navScrolled ? 'blur(20px)' : 'none',
        borderBottom: navScrolled ? '1px solid rgba(212,175,55,0.1)' : '1px solid transparent',
        transition: 'all 0.3s ease',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ fontSize: '22px' }}>🎰</div>
          <span style={{ fontWeight: 800, fontSize: '1.05rem', letterSpacing: '1.5px', color: Gold }}>ACTION SYNC</span>
        </div>

        {/* Nav links (desktop) */}
        {!isMobile && (
          <div style={{ display: 'flex', gap: '32px' }}>
            {['Features', 'Games', 'How It Works'].map(l => (
              <a
                key={l}
                href={`#${l.toLowerCase().replace(/ /g, '-')}`}
                className="lp-nav-link"
                style={{ color: '#94a3b8', fontSize: '0.875rem', fontWeight: 500, textDecoration: 'none' }}
              >{l}</a>
            ))}
          </div>
        )}

        {/* CTA */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => setAuthMode('dealerSignIn')}
            className="lp-btn-outline"
            style={{ padding: '8px 18px', background: 'transparent', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '8px', color: '#94a3b8', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >Sign In</button>
          <button
            onClick={() => setAuthMode('dealerSignUp')}
            className="lp-btn-primary"
            style={{ padding: '8px 18px', background: Gold, border: 'none', borderRadius: '8px', color: '#000', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >Get Started</button>
        </div>
      </nav>

      {/* ═══════════════════════════════ HERO ═══════════════════════════════ */}
      <section style={{
        position: 'relative', zIndex: 1,
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? '120px 20px 80px' : '140px 40px 100px',
        textAlign: 'center',
      }}>

        {/* Live badge */}
        <div className="lp-fade-up" style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          padding: '6px 16px',
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: '20px',
          marginBottom: '28px',
          fontSize: '0.78rem', fontWeight: 700, color: '#22c55e', letterSpacing: '1px',
        }}>
          <span className="lp-live-dot" style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
          LIVE CASINO FOR STREAMERS
        </div>

        {/* Headline */}
        <h1 className="lp-fade-up-2" style={{
          margin: '0 0 20px',
          fontSize: isMobile ? '2.4rem' : '4rem',
          fontWeight: 900,
          lineHeight: 1.1,
          letterSpacing: '-1px',
          maxWidth: '760px',
        }}>
          <span className="lp-shimmer-text">The casino companion</span>
          <br />
          <span style={{ color: '#e2e8f0' }}>your stream deserves.</span>
        </h1>

        {/* Subheading */}
        <p className="lp-fade-up-3" style={{
          color: '#64748b',
          fontSize: isMobile ? '1rem' : '1.15rem',
          lineHeight: 1.7,
          maxWidth: '520px',
          margin: '0 0 40px',
        }}>
          Real-time virtual casino betting for you and your viewers — Roulette, Craps &amp; Baccarat. No real money, infinite hype.
        </p>

        {/* Hero CTA row */}
        <div className="lp-fade-up-4" style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          gap: '12px',
          alignItems: 'center',
          width: '100%',
          maxWidth: '480px',
          marginBottom: '20px',
        }}>
          {/* Join room input */}
          <div style={{ display: 'flex', gap: '8px', flex: 1, width: '100%' }}>
            <input
              type="text"
              value={joinCodeInput}
              onChange={e => {
                setJoinCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                setResolveError(null);
              }}
              onKeyPress={e => e.key === 'Enter' && handleJoinByCode()}
              placeholder="Enter room code..."
              maxLength={16}
              className="lp-input"
              style={{
                flex: 1,
                padding: '14px 16px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px',
                color: '#e2e8f0',
                fontSize: '0.9rem',
                fontFamily: 'inherit',
                letterSpacing: '2px',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
            />
            <button
              onClick={handleJoinByCode}
              disabled={joinCodeLoading || !joinCodeInput.trim()}
              className="lp-btn-primary"
              style={{
                padding: '14px 20px',
                background: joinCodeInput.trim() ? Gold : 'rgba(255,255,255,0.05)',
                border: 'none', borderRadius: '10px',
                color: joinCodeInput.trim() ? '#000' : '#555',
                fontWeight: 700, fontSize: '0.9rem',
                cursor: joinCodeInput.trim() ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >{joinCodeLoading ? '...' : 'Join →'}</button>
          </div>

          <div style={{ color: '#374151', fontSize: '0.8rem', flexShrink: 0 }}>or</div>

          <button
            onClick={() => setAuthMode('dealerSignUp')}
            className="lp-btn-primary"
            style={{
              padding: '14px 24px',
              background: Gold,
              border: 'none', borderRadius: '10px',
              color: '#000', fontWeight: 700, fontSize: '0.9rem',
              cursor: 'pointer', fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >Go Live Free →</button>
        </div>

        {resolveError && (
          <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '-8px', marginBottom: '8px' }}>{resolveError}</div>
        )}

        <p style={{ color: '#374151', fontSize: '0.75rem', margin: '4px 0 0' }}>
          Free to use · No real money · Virtual chips only
        </p>

        {/* Hero screenshot / mock card */}
        <div className="lp-float lp-glow" style={{
          marginTop: '64px',
          background: 'linear-gradient(145deg, rgba(13,16,38,0.95) 0%, rgba(10,14,39,0.85) 100%)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(212,175,55,0.2)',
          borderRadius: '20px',
          padding: '28px 32px',
          maxWidth: '560px',
          width: '100%',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}>
          {/* Fake leaderboard */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e' }} className="lp-live-dot" />
            <span style={{ color: '#22c55e', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '1px' }}>LIVE SESSION</span>
            <span style={{ color: '#374151', fontSize: '0.75rem', marginLeft: 'auto' }}>🎡 Roulette · Round 7</span>
          </div>
          {[
            { rank: '🥇', name: 'xXDragonSlayerXx', chips: '12,480', delta: '+1,200', pos: true },
            { rank: '🥈', name: 'CryptoQueen_99',   chips: '10,340', delta: '+380',   pos: true },
            { rank: '🥉', name: 'NightOwlBets',      chips: '8,750',  delta: '-420',   pos: false },
            { rank: '4',  name: 'StakeMaster',        chips: '7,920',  delta: '+640',   pos: true },
          ].map((p, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '10px 12px',
              background: i === 0 ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)',
              borderRadius: '10px',
              marginBottom: '6px',
              border: i === 0 ? '1px solid rgba(212,175,55,0.2)' : '1px solid transparent',
            }}>
              <span style={{ fontSize: '1rem', width: '24px', textAlign: 'center' }}>{p.rank}</span>
              <span style={{ flex: 1, color: i === 0 ? Gold : '#94a3b8', fontWeight: i === 0 ? 700 : 500, fontSize: '0.85rem' }}>{p.name}</span>
              <span style={{ color: p.pos ? '#22c55e' : '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>{p.delta}</span>
              <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.88rem', minWidth: '64px', textAlign: 'right' }}>🪙 {p.chips}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════ STATS BAR ═══════════════════════════════ */}
      <section style={{
        position: 'relative', zIndex: 1,
        padding: isMobile ? '48px 24px' : '64px 80px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: '40px', justifyContent: 'space-around' }}>
          <StatCard value={24800}  suffix="+"  label="Games Played"   delay={0} />
          <StatCard value={3}      suffix=""   label="Casino Games"    delay={0.1} />
          <StatCard value={100}    suffix="%"  label="Virtual — Safe"  delay={0.2} />
          <StatCard value={0}      suffix="$"  label="Real Money Used" delay={0.3} />
        </div>
      </section>

      {/* ═══════════════════════════════ FEATURES ═══════════════════════════════ */}
      <section id="features" style={{ position: 'relative', zIndex: 1, padding: isMobile ? '72px 24px' : '96px 80px' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>

          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div className="lp-fade-up" style={{ color: Gold, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '12px' }}>Why streamers love it</div>
            <h2 className="lp-fade-up-2" style={{ margin: 0, fontSize: isMobile ? '1.8rem' : '2.4rem', fontWeight: 800, color: '#e2e8f0', letterSpacing: '-0.5px' }}>
              Everything you need to run<br />a premium casino stream
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '16px' }}>
            {features.map((f, i) => (
              <FeatureCard key={f.title} {...f} delay={i * 0.07} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════ GAMES ═══════════════════════════════ */}
      <section id="games" style={{
        position: 'relative', zIndex: 1,
        padding: isMobile ? '72px 24px' : '96px 80px',
        background: 'rgba(255,255,255,0.015)',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>

          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div className="lp-fade-up" style={{ color: Gold, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '12px' }}>The games</div>
            <h2 className="lp-fade-up-2" style={{ margin: 0, fontSize: isMobile ? '1.8rem' : '2.4rem', fontWeight: 800, color: '#e2e8f0', letterSpacing: '-0.5px' }}>
              Three classic tables.<br />Infinite stream moments.
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '16px' }}>
            {games.map((g, i) => <GameCard key={g.name} {...g} delay={i * 0.1} />)}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════ HOW IT WORKS ═══════════════════════════════ */}
      <section id="how-it-works" style={{ position: 'relative', zIndex: 1, padding: isMobile ? '72px 24px' : '96px 80px' }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>

          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div className="lp-fade-up" style={{ color: Gold, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '12px' }}>Getting started</div>
            <h2 className="lp-fade-up-2" style={{ margin: 0, fontSize: isMobile ? '1.8rem' : '2.4rem', fontWeight: 800, color: '#e2e8f0', letterSpacing: '-0.5px' }}>
              Live in four steps.
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {steps.map((s, i) => (
              <Step key={s.title} number={i + 1} {...s} delay={i * 0.1} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════ FINAL CTA ═══════════════════════════════ */}
      <section style={{
        position: 'relative', zIndex: 1,
        padding: isMobile ? '72px 24px' : '96px 80px',
        textAlign: 'center',
      }}>
        {/* CTA card */}
        <div className="lp-glow" style={{
          maxWidth: '680px',
          margin: '0 auto',
          background: 'linear-gradient(145deg, rgba(13,16,38,0.95) 0%, rgba(20,24,50,0.9) 100%)',
          border: '1px solid rgba(212,175,55,0.25)',
          borderRadius: '24px',
          padding: isMobile ? '48px 28px' : '64px 80px',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Corner glow */}
          <div aria-hidden style={{
            position: 'absolute', top: '-60px', right: '-60px',
            width: '200px', height: '200px', borderRadius: '50%',
            background: Gold, opacity: 0.06, filter: 'blur(60px)', pointerEvents: 'none',
          }} />

          <div className="lp-fade-up" style={{ fontSize: '3rem', marginBottom: '20px' }}>🎰</div>
          <h2 className="lp-fade-up-2" style={{ margin: '0 0 12px', fontSize: isMobile ? '1.8rem' : '2.2rem', fontWeight: 800, color: '#e2e8f0', letterSpacing: '-0.5px' }}>
            Ready to go live?
          </h2>
          <p className="lp-fade-up-3" style={{ color: '#64748b', fontSize: '1rem', lineHeight: 1.7, margin: '0 0 36px', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
            Create your free dealer account in seconds and give your stream the edge it needs.
          </p>

          <div className="lp-fade-up-4" style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => setAuthMode('dealerSignUp')}
              className="lp-btn-primary"
              style={{
                padding: '15px 36px',
                background: Gold,
                border: 'none', borderRadius: '12px',
                color: '#000', fontWeight: 800, fontSize: '1rem',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Create Free Account →</button>
            <button
              onClick={() => setAuthMode('dealerSignIn')}
              className="lp-btn-outline"
              style={{
                padding: '15px 28px',
                background: 'transparent',
                border: '1px solid rgba(212,175,55,0.3)',
                borderRadius: '12px',
                color: '#94a3b8', fontWeight: 600, fontSize: '1rem',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Sign In</button>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════ FOOTER ═══════════════════════════════ */}
      <footer style={{
        position: 'relative', zIndex: 1,
        padding: isMobile ? '32px 24px' : '40px 80px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>🎰</span>
          <span style={{ fontWeight: 800, fontSize: '0.9rem', color: Gold, letterSpacing: '1px' }}>ACTION SYNC</span>
        </div>
        <p style={{ color: '#374151', fontSize: '0.75rem', margin: 0, textAlign: 'center' }}>
          Virtual entertainment only · No real money is used · 18+ only
        </p>
        <div style={{ display: 'flex', gap: '20px' }}>
          <button onClick={() => setAuthMode('dealerSignIn')} style={{ background: 'none', border: 'none', color: '#4a5568', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Dealer Sign In</button>
          <button onClick={() => setAuthMode('dealerSignUp')} style={{ background: 'none', border: 'none', color: '#4a5568', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}>Create Account</button>
        </div>
      </footer>

    </div>
  );
}
