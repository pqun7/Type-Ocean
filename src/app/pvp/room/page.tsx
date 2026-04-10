'use client';

import { useState, useRef, useEffect, ClipboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DoorOpen,
  LockKeyhole,
  Sparkles,
  Sword,
  Trophy,
  Users,
  Zap,
  Copy,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ArrowRight,
  Globe,
  Shield,
  Hash,
} from 'lucide-react';
import Header from '@/components/layout/Header/Header';

// ============================================================================
// Premium UI Components (inspired by reference Arena design)
// ============================================================================

const GlassCard = ({
  children,
  className = '',
  glowColor = 'cyan',
}: {
  children: React.ReactNode;
  className?: string;
  glowColor?: 'cyan' | 'purple' | 'pink';
}) => {
  const glowMap = {
    cyan: 'from-cyan-500/20 via-blue-500/10 to-transparent',
    purple: 'from-purple-500/20 via-pink-500/10 to-transparent',
    pink: 'from-pink-500/20 via-rose-500/10 to-transparent',
  };
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] backdrop-blur-xl transition-all duration-500 hover:border-white/20 hover:shadow-2xl ${className}`}
    >
      <div
        className={`absolute -inset-px bg-gradient-to-r ${glowMap[glowColor]} opacity-0 blur-2xl transition-opacity duration-700 group-hover:opacity-100`}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      {children}
    </div>
  );
};

const PremiumButton = ({
  onClick,
  children,
  disabled,
  loading = false,
  variant = 'primary',
  icon: Icon = null,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: React.ElementType | null;
}) => {
  const variants = {
    primary: {
      bg: 'from-cyan-500 via-blue-500 to-purple-600',
      shadow: 'shadow-[0_8px_20px_-6px_rgba(6,182,212,0.3)]',
      hover: 'hover:shadow-[0_8px_25px_-6px_rgba(6,182,212,0.5)]',
      text: 'text-white',
    },
    secondary: {
      bg: 'from-slate-600 via-slate-500 to-zinc-600',
      shadow: 'shadow-none',
      hover: 'hover:shadow-[0_4px_15px_-3px_rgba(255,255,255,0.1)]',
      text: 'text-white/90',
    },
    danger: {
      bg: 'from-red-500 via-rose-500 to-red-600',
      shadow: 'shadow-[0_8px_20px_-6px_rgba(239,68,68,0.3)]',
      hover: 'hover:shadow-[0_8px_25px_-6px_rgba(239,68,68,0.5)]',
      text: 'text-white',
    },
  };
  const current = variants[variant];

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled || loading}
      className={`relative overflow-hidden rounded-xl px-5 py-2.5 font-bold text-sm uppercase tracking-wider transition-all duration-300 ${
        disabled || loading ? 'cursor-not-allowed opacity-60' : `${current.hover} hover:scale-[1.02] active:scale-[0.98]`
      } ${current.shadow}`}
      style={{
        background: `linear-gradient(135deg, ${current.bg.split(' ').join(', ')})`,
      }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
      <span className={`relative flex items-center justify-center gap-2 ${current.text}`}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {children}
          </>
        )}
      </span>
    </motion.button>
  );
};

const RuleItem = ({ icon: Icon, text }: { icon: React.ElementType; text: string }) => (
  <motion.div
    className="group flex items-start gap-2 rounded-lg p-1.5 transition-all hover:bg-white/5"
    whileHover={{ x: 4 }}
  >
    <div className="shrink-0 rounded-full bg-cyan-500/10 p-1 text-cyan-400 transition-all group-hover:scale-110 group-hover:bg-cyan-500/20">
      <Icon className="h-3 w-3" />
    </div>
    <span className="text-[11px] leading-relaxed text-white/50 group-hover:text-white/80">{text}</span>
  </motion.div>
);

const StyledSelect = ({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (val: number) => void;
  options: number[];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative">
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-white/20 bg-black/40 px-4 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition-all hover:border-cyan-500/50 focus:outline-none"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {value} Players
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </motion.button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute left-0 top-full z-20 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-black/90 backdrop-blur-xl"
          >
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  onChange(opt);
                  setIsOpen(false);
                }}
                className={`w-full px-4 py-2 text-left text-sm transition-all hover:bg-white/10 ${
                  value === opt ? 'text-cyan-400' : 'text-white/70'
                }`}
              >
                {opt} Players
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// OTP-style Code Input Component (letters only, 8 boxes with dash)
// ============================================================================
interface CodeInputProps {
  value: string; // full code with dash (e.g., "ABCD-EFGH")
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
}

const CodeInput = ({ value, onChange, onComplete }: CodeInputProps) => {
  const [digits, setDigits] = useState<string[]>(() => {
    const clean = value.replace('-', '');
    const arr = clean.split('').slice(0, 8);
    while (arr.length < 8) arr.push('');
    return arr;
  });
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Sync external value changes (e.g., paste from demo)
  useEffect(() => {
    const clean = value.replace('-', '');
    const newDigits = clean.split('').slice(0, 8);
    while (newDigits.length < 8) newDigits.push('');
    setDigits(newDigits);
  }, [value]);

  const updateFullCode = (newDigits: string[]) => {
    const firstPart = newDigits.slice(0, 4).join('');
    const secondPart = newDigits.slice(4, 8).join('');
    const formatted = `${firstPart}-${secondPart}`;
    onChange(formatted);
    if (newDigits.every(d => d.match(/[A-Z]/)) && newDigits.length === 8) {
      onComplete?.(formatted);
    }
  };

  const handleChange = (index: number, val: string) => {
    // Only allow letters A-Z, convert to uppercase
    let upperVal = val.toUpperCase().replace(/[^A-Z]/g, '');
    if (upperVal.length > 1) upperVal = upperVal.slice(0, 1);
    const newDigits = [...digits];
    newDigits[index] = upperVal;
    setDigits(newDigits);
    updateFullCode(newDigits);

    // Move to next input if value entered
    if (upperVal && index < 7) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index] === '') {
        // Move to previous input if current is empty
        if (index > 0) {
          inputRefs.current[index - 1]?.focus();
        }
      } else {
        // Clear current
        const newDigits = [...digits];
        newDigits[index] = '';
        setDigits(newDigits);
        updateFullCode(newDigits);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 7) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z]/g, '');
    const pastedArr = pasted.split('').slice(0, 8);
    const newDigits = [...digits];
    for (let i = 0; i < pastedArr.length; i++) {
      if (i < 8) newDigits[i] = pastedArr[i];
    }
    setDigits(newDigits);
    updateFullCode(newDigits);
    // Focus last filled or first empty
    const lastFilledIndex = newDigits.findLastIndex(d => d !== '');
    const focusIndex = lastFilledIndex === -1 ? 0 : Math.min(lastFilledIndex + 1, 7);
    inputRefs.current[focusIndex]?.focus();
  };

  return (
    <div className="flex items-center justify-center gap-2">
      {/* First 4 boxes */}
      {digits.slice(0, 4).map((digit, idx) => (
        <input
          key={idx}
          ref={(el) => { inputRefs.current[idx] = el; }}
          type="text"
          inputMode="text"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={idx === 0 ? handlePaste : undefined}
          className="h-12 w-12 rounded-xl border border-white/20 bg-black/40 text-center font-mono text-xl font-bold text-white transition-all focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
          autoFocus={idx === 0}
        />
      ))}
      {/* Dash separator */}
      <span className="text-2xl font-bold text-white/30">-</span>
      {/* Last 4 boxes */}
      {digits.slice(4, 8).map((digit, idx) => {
        const globalIdx = idx + 4;
        return (
          <input
            key={globalIdx}
            ref={(el) => { inputRefs.current[globalIdx] = el; }}
            type="text"
            inputMode="text"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(globalIdx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(globalIdx, e)}
            className="h-12 w-12 rounded-xl border border-white/20 bg-black/40 text-center font-mono text-xl font-bold text-white transition-all focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-400/50"
          />
        );
      })}
    </div>
  );
};

// ============================================================================
// Main Page Component
// ============================================================================

export default function PvpRoomsPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4 | 5 | 6>(6);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  async function createRoom() {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/pvp/rooms/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxPlayers }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Failed to create room');
      router.push(`/pvp/room/${body.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsCreating(false);
    }
  }

  function joinRoom() {
    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) return;
    setIsJoining(true);
    router.push(`/pvp/room/${trimmedCode}`);
  }

  const handleCopyDemoCode = () => {
    // Demo code now uses only letters (8 letters)
    const demoCode = 'ARENA-CODE';
    navigator.clipboard.writeText(demoCode);
    setCode(demoCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-join when code is fully entered (optional)
  const handleCodeComplete = (fullCode: string) => {
    // Optional: auto-join after 8 letters
    // joinRoom();
  };

  return (
    <>
      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes borderFlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-float { animation: float 4s ease-in-out infinite; }
        .border-flow {
          background: linear-gradient(90deg, #00d4ff, #a78bfa, #f87171, #00d4ff);
          background-size: 300% 100%;
          animation: borderFlow 6s ease infinite;
        }
        .fade-slide-up {
          animation: fadeSlideUp 0.6s ease-out forwards;
        }
      `}</style>

      <div className="relative min-h-screen overflow-hidden">
        {/* Premium Animated Background */}
        <div className="fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-[#050814] via-[#0a0f1a] to-[#030614]" />
          <div className="absolute top-0 left-1/3 h-[600px] w-[600px] rounded-full bg-blue-600/10 blur-[140px] animate-pulse" />
          <div className="absolute bottom-0 right-1/4 h-[500px] w-[500px] rounded-full bg-purple-600/10 blur-[140px] animate-pulse delay-1000" />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2280%22%20height%3D%2280%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22grid%22%20width%3D%2280%22%20height%3D%2280%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Cpath%20d%3D%22M%2080%200%20L%200%200%200%2080%22%20fill%3D%22none%22%20stroke%3D%22rgba%28255%2C255%2C255%2C0.02%29%22%20stroke-width%3D%221%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url%28%23grid%29%22/%3E%3C/svg%3E')] opacity-20" />
          <div className="absolute bottom-20 left-10 h-32 w-32 rounded-full bg-cyan-500/5 blur-[80px]" />
          <div className="absolute top-40 right-20 h-40 w-40 rounded-full bg-pink-500/5 blur-[100px]" />
        </div>

        <Header />

        <main className="relative mx-auto max-w-6xl px-4 pt-[6rem] pb-12 lg:pt-[7rem]">
          {/* Hero Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12 text-center"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 backdrop-blur-sm mb-5">
              <Sword className="h-3 w-3 text-cyan-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">Private Arenas · Web3 Ready</span>
            </div>
            <h1 className="bg-gradient-to-r from-white via-cyan-100 to-purple-200 bg-clip-text text-5xl font-black tracking-tight text-transparent sm:text-6xl">
              Create Your Lobby
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm text-white/40">
              Host encrypted, password-protected rooms. Invite friends via a unique code and start a private ranked match with full Web3 security.
            </p>
          </motion.div>

          {/* Main Glass Card */}
          <GlassCard className="fade-slide-up" glowColor="cyan">
            <div className="p-6 md:p-8">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative mb-8 overflow-hidden rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 backdrop-blur-sm"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 to-transparent" />
                  <p className="text-sm text-red-300">{error}</p>
                </motion.div>
              )}

              <div className="grid gap-8 md:grid-cols-2">
                {/* Create New Lobby Card */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                  className="group relative rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-6 transition-all hover:border-cyan-500/30 hover:shadow-[0_0_30px_-12px_rgba(6,182,212,0.3)]"
                >
                  <div className="absolute -right-3 -top-3 h-20 w-20 rounded-full bg-cyan-500/20 blur-3xl transition-all group-hover:bg-cyan-500/30" />
                  <div className="relative">
                    <div className="mb-5 flex items-center gap-3">
                      <div className="rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 p-2.5">
                        <Sparkles className="h-5 w-5 text-cyan-400" />
                      </div>
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-cyan-300">Create New Lobby</span>
                        <p className="text-[10px] text-white/30">Generate a unique arena code</p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div>
                        <label className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/50">
                          <Users className="h-3 w-3" />
                          Max Capacity
                        </label>
                        <StyledSelect
                          value={maxPlayers}
                          onChange={(val) => setMaxPlayers(val as typeof maxPlayers)}
                          options={[2, 3, 4, 5, 6]}
                        />
                      </div>

                      <PremiumButton
                        onClick={createRoom}
                        loading={isCreating}
                        icon={Zap}
                        variant="primary"
                        disabled={isCreating}
                      >
                        {isCreating ? 'Generating...' : 'Generate Room'}
                      </PremiumButton>

                      <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/5 bg-white/5 p-2">
                        <Shield className="h-3 w-3 text-cyan-400/60" />
                        <span className="text-[9px] text-white/30">Encrypted room · Auto-expires after 30min</span>
                      </div>
                    </div>
                  </div>
                </motion.div>

                {/* Join Existing Lobby Card with OTP Code Input */}
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                  className="group relative rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-6 transition-all hover:border-purple-500/30 hover:shadow-[0_0_30px_-12px_rgba(168,85,247,0.3)]"
                >
                  <div className="absolute -left-3 -bottom-3 h-20 w-20 rounded-full bg-purple-500/20 blur-3xl transition-all group-hover:bg-purple-500/30" />
                  <div className="relative">
                    <div className="mb-5 flex items-center gap-3">
                      <div className="rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 p-2.5">
                        <DoorOpen className="h-5 w-5 text-purple-400" />
                      </div>
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-purple-300">Join Existing</span>
                        <p className="text-[10px] text-white/30">Enter the 8‑letter arena passcode</p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div>
                        <label className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/50">
                          <Hash className="h-3 w-3" />
                          Room Code (letters only)
                        </label>
                        <CodeInput
                          value={code}
                          onChange={setCode}
                          onComplete={handleCodeComplete}
                        />
                      </div>

                      <PremiumButton
                        onClick={joinRoom}
                        loading={isJoining}
                        icon={ArrowRight}
                        variant="secondary"
                        disabled={code.length !== 9} // 8 letters + dash
                      >
                        Join Arena
                      </PremiumButton>

                      {/* Demo Code Helper with Copy Animation */}
                      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-3 transition-all hover:bg-white/10">
                        <div className="flex items-center gap-2">
                          <Globe className="h-3 w-3 text-cyan-400/60" />
                          <span className="text-[10px] font-mono text-white/40">Demo: ARENA-CODE</span>
                        </div>
                        <motion.button
                          onClick={handleCopyDemoCode}
                          className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1 text-[10px] font-medium text-cyan-300 transition-all hover:bg-cyan-500/20"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                        >
                          {copied ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </motion.button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Arena Protocol & Stats */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-10 rounded-2xl border border-white/5 bg-gradient-to-r from-white/5 to-transparent p-5"
              >
                <div className="mb-4 flex items-center gap-2.5">
                  <div className="rounded-full bg-amber-500/20 p-1.5">
                    <Trophy className="h-3.5 w-3.5 text-amber-400" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">Arena Protocol</span>
                  <div className="h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <RuleItem icon={Users} text="Private rooms are encrypted and expire after 30 minutes" />
                  <RuleItem icon={Zap} text="Host can start match when all players are ready" />
                  <RuleItem icon={Sword} text="Ranked points only awarded in official 1v1 queue" />
                  <RuleItem icon={LockKeyhole} text="Room host can kick disruptive players" />
                </div>
              </motion.div>

              {/* Additional Web3 Badge */}
              <div className="mt-6 flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur-sm">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[9px] font-mono uppercase tracking-wider text-white/40">Secure enclave · On-chain verification ready</span>
                </div>
              </div>
            </div>
          </GlassCard>
        </main>
      </div>
    </>
  );
}