/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useRef, useCallback } from 'react';

declare const gsap: any;

// ─── Content per scenario ───────────────────────────────────────────────────
interface ScenarioContent {
  eyebrow: string;
  title: string;
  description: string;
  cta?: { label: string; href: string };
}

function getContent(isFirstEver: boolean, isAuthenticated: boolean): ScenarioContent {
  if (!isFirstEver) {
    return {
      eyebrow: 'GOOD TO HAVE YOU BACK',
      title: 'Press F11',
      description: 'Go fullscreen for the immersive typing experience.',
    };
  }
  if (isAuthenticated) {
    return {
      eyebrow: 'WELCOME TO TYPE OCEAN',
      title: 'Dive In',
      description: 'Test your typing speed, challenge others,\nand explore the ocean of words.',
    };
  }
  return {
    eyebrow: 'WELCOME TO TYPE OCEAN',
    title: 'Start Your Journey',
    description:
      'Sign in to track your progress, compete on the leaderboard,\nand unlock the full typing experience.',
    cta: { label: 'Sign In', href: '/auth?form=login' },
  };
}

// ─── Component ───────────────────────────────────────────────────────────────
interface Props {
  isFirstEver: boolean;
  isAuthenticated: boolean;
  onClose: () => void;
}

export function Component({ isFirstEver, isAuthenticated, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const eyebrowRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const descRef = useRef<HTMLParagraphElement>(null);
  const primaryButtonRef = useRef<HTMLAnchorElement>(null);
  const guestButtonRef = useRef<HTMLButtonElement>(null);
  const hintRef = useRef<HTMLParagraphElement>(null);
  const bugRef = useRef<HTMLParagraphElement>(null);
  const closingRef = useRef(false);

  const content = getContent(isFirstEver, isAuthenticated);

  // --- Exit animation (triggered by F11 or guest button) ---
  const exit = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;

    const overlay = overlayRef.current;
    if (!overlay || !(window as any).gsap) {
      onClose();
      return;
    }

    // Kill any running tweens on animated elements
    if (titleRef.current) gsap.killTweensOf(titleRef.current.children);
    gsap.killTweensOf([
      eyebrowRef.current,
      descRef.current,
      primaryButtonRef.current,
      guestButtonRef.current,
      hintRef.current,
      bugRef.current,
    ]);

    // Fade out all content
    gsap.to(
      [
        titleRef.current?.children ?? [],
        eyebrowRef.current,
        descRef.current,
        primaryButtonRef.current,
        guestButtonRef.current,
        hintRef.current,
        bugRef.current,
      ],
      { opacity: 0, y: -16, duration: 0.35, stagger: 0.02, ease: 'power2.in' }
    );

    // Collapse overlay
    gsap.to(overlay, {
      clipPath: 'circle(0% at 50% 50%)',
      opacity: 0,
      duration: 1.2,
      delay: 0.3,
      ease: 'power2.inOut',
      onComplete: onClose,
    });
  }, [onClose]);

  useEffect(() => {
    // Load GSAP once
    const loadGsap = (): Promise<void> => {
      if ((window as any).gsap) return Promise.resolve();
      return new Promise((res, rej) => {
        if (document.querySelector('script[data-gsap]')) {
          const poll = setInterval(() => {
            if ((window as any).gsap) {
              clearInterval(poll);
              res();
            }
          }, 50);
          return;
        }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js';
        s.dataset.gsap = '1';
        s.onload = () => setTimeout(res, 80);
        s.onerror = () => rej(new Error('Failed to load GSAP'));
        document.head.appendChild(s);
      });
    };

    // Split title into individual letter spans
    const splitTitle = () => {
      const el = titleRef.current;
      if (!el) return;
      const text = el.dataset.text ?? el.textContent ?? '';
      el.innerHTML = text
        .split('')
        .map((c) => `<span style="display:inline-block;opacity:0">${c === ' ' ? '&nbsp;' : c}</span>`)
        .join('');
    };

    // Entry animation
    const animateIn = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;

      // Main overlay reveal
      gsap.fromTo(
        overlay,
        { clipPath: 'circle(0% at 50% 50%)', opacity: 0 },
        { clipPath: 'circle(150% at 50% 50%)', opacity: 1, duration: 1.8, ease: 'power2.inOut' }
      );

      // Eyebrow (only if present)
      if (eyebrowRef.current) {
        gsap.fromTo(eyebrowRef.current, { y: -12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: 0.9 });
      }

      // Title letters
      if (titleRef.current?.children.length) {
        gsap.fromTo(
          titleRef.current.children,
          { y: 50, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.9, stagger: 0.035, ease: 'power3.out', delay: 1.05 }
        );
      }

      // Description
      gsap.fromTo(descRef.current, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out', delay: 1.4 });

      // Primary button (if exists)
      if (primaryButtonRef.current) {
        gsap.fromTo(
          primaryButtonRef.current,
          { y: 14, opacity: 0, scale: 0.94 },
          { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(1.4)', delay: 1.65 }
        );
      }

      // Guest button (if exists)
      if (guestButtonRef.current) {
        gsap.fromTo(
          guestButtonRef.current,
          { y: 14, opacity: 0, scale: 0.94 },
          { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: 'back.out(1.4)', delay: 1.65 }
        );
      }

      // Hint and bug
      gsap.fromTo(hintRef.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', delay: 1.9 });
      gsap.fromTo(bugRef.current, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out', delay: 2.2 });
    };

    // F11 keyboard listener
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        exit();
      }
    };

    // Bootstrap
    loadGsap()
      .then(() => {
        splitTitle();
        animateIn();
      })
      .catch(console.error);

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exit]); // exit is stable

  // Determine if we need to show the two‑button block (first visit, not signed in)
  const showGuestOptions = !isAuthenticated && isFirstEver;

  return (
    <div
      ref={overlayRef}
      style={{
        clipPath: 'circle(0% at 50% 50%)',
        opacity: 0,
        background: 'rgba(8,16,36,0.55)',
        backdropFilter: 'blur(18px) saturate(160%)',
        WebkitBackdropFilter: 'blur(18px) saturate(160%)',
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
    >
      {/* Central glow – untouched */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 55% 45% at 50% 50%, rgba(30,90,200,0.28) 0%, transparent 70%)',
        }}
      />

      {/* Content container – no card */}
      <div className="relative z-10 select-none text-center px-8 max-w-lg w-full flex flex-col items-center">

        {/* Eyebrow — always shown, all 3 scenarios have one */}
        <span
          ref={eyebrowRef}
          className="block mb-3 text-xs sm:text-sm font-semibold tracking-[0.26em] uppercase"
          style={{
            color: 'rgba(160,220,255,0.75)',
            textShadow: '0 0 20px rgba(100,180,255,0.45)',
          }}
        >
          {content.eyebrow}
        </span>

        {/* Title */}
        <h1
          ref={titleRef}
          data-text={content.title}
          className="mb-4 text-5xl sm:text-6xl font-bold leading-tight tracking-[-0.02em]"
          style={{
            background: 'linear-gradient(135deg, #ffffff 25%, rgba(200,235,255,0.9) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 0 30px rgba(100,180,255,0.5))',
          }}
        >
          {content.title}
        </h1>

        {/* Description */}
        <p
          ref={descRef}
          className="text-base sm:text-lg leading-relaxed"
          style={{
            color: 'rgba(210,235,255,0.75)',
            whiteSpace: 'pre-line',
            textShadow: '0 2px 12px rgba(0,20,50,0.9)',
          }}
        >
          {content.description}
        </p>

        {/* Two‑button area for guest first visit */}
        {showGuestOptions ? (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8 mb-8">
            <a
              ref={primaryButtonRef}
              href="/auth?form=login"
              className="inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl font-semibold text-sm text-white transition duration-200 hover:scale-[1.02] hover:brightness-110"
              style={{
                background: 'linear-gradient(135deg, rgba(45,110,220,0.9) 0%, rgba(30,70,180,0.95) 100%)',
                border: '1px solid rgba(160,220,255,0.3)',
                boxShadow: '0 8px 28px rgba(30,80,200,0.5), 0 0 30px rgba(70,140,255,0.3)',
              }}
            >
              Sign in to save progress
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M5 12H19M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </a>
            <button
              ref={guestButtonRef}
              onClick={exit}
              className="text-sm font-medium text-white/60 hover:text-white transition-colors underline-offset-2 hover:underline px-4 py-2"
            >
              Continue as guest
            </button>
          </div>
        ) : (
          <div className="mt-8 mb-8" />
        )}

        {/* F11 hint — always shown */}
        <p
          ref={hintRef}
          className="flex items-center justify-center gap-2 text-sm"
          style={{ color: 'rgba(200,230,255,0.55)' }}
        >
          Press{' '}
          <kbd
            className="inline-block px-2 py-0.5 rounded text-xs font-mono"
            style={{
              background: 'rgba(20,50,100,0.8)',
              border: '1px solid rgba(160,220,255,0.3)',
              color: 'rgba(220,240,255,0.95)',
              boxShadow: '0 0 15px rgba(80,160,255,0.3)',
            }}
          >
            F11
          </kbd>{' '}
          for the full experience
        </p>
      </div>

      {/* Bottom bug note */}
      <p
        ref={bugRef}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs text-center whitespace-nowrap"
        style={{ color: 'rgba(180,220,255,0.3)' }}
      >
        If F11 is not working, refresh the page
      </p>
    </div>
  );
}