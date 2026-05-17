"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  DoorOpen,
  Sparkles,
  Sword,
  Trophy,
  Users,
  Plus,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ArrowRight,
  Hash,
  Wifi,
  Crown,
  ShieldCheck,
  Eye,
} from "lucide-react";
import Header from "@/components/layout/Header/Header";
import { Button } from "@/components/ui/button";
import { useAlert } from "@/contexts/alert-context";

const glassGlowMap = {
  cyan: "from-cyan-500/5 via-cyan-400/5 to-transparent",
  purple: "from-purple-500/5 via-purple-400/5 to-transparent",
  amber: "from-amber-500/5 via-amber-400/5 to-transparent",
} as const;

const ambientOracleTips = [
  { icon: Sword, text: "Host decides when the battle begins." },
  { icon: ShieldCheck, text: "Kick players or lock the lobby anytime." },
  { icon: Eye, text: "Spectate matches while you wait." },
  { icon: Wifi, text: "Low‑latency dedicated servers." },
  { icon: Trophy, text: "Wins here don’t affect public rank." },
];

// ============================================================================
// Premium Glass Card 3.0 – Whisper‑light Elegance for 2027
// ============================================================================
// ============================================================================
// Premium Glass Card 3.1 – Fixed Field Visibility on Hover
// ============================================================================
const GlassCard = ({
  children,
  className = "",
  glowColor = "cyan",
  depth = "default",
}: {
  children: ReactNode;
  className?: string;
  glowColor?: "cyan" | "purple" | "amber";
  depth?: "default" | "elevated";
}) => {
  const depthClass =
    depth === "elevated"
      ? "shadow-[0_20px_40px_-12px_rgba(0,0,0,0.4),0_8px_20px_-8px_rgba(0,0,0,0.3)]"
      : "shadow-[0_12px_24px_-8px_rgba(0,0,0,0.3),0_4px_12px_-4px_rgba(0,0,0,0.2)]";

  return (
    <div
      className={`
        group relative rounded-3xl
        border border-white/[0.06]
        bg-black/15 backdrop-blur-md
        transition-all duration-700 ease-out
        hover:border-white/[0.12]
        ${depthClass}
        ${className}
      `}
    >
      {/* الطبقات الزخرفية محصورة داخلها overflow-hidden */}
      <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
        <div
          className={`
            absolute inset-0 z-0
            bg-gradient-to-r ${glassGlowMap[glowColor]}
            opacity-0 blur-2xl transition-opacity duration-1000
            group-hover:opacity-100
          `}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
      </div>

      {/* المحتوى – يمكنه الفيض خارج الحدود (للـ dropdown) */}
      <div className="relative z-10">{children}</div>
    </div>
  );
};

// ============================================================================
// Organic Fluid Select (Responsive)
// ============================================================================
const FluidSelect = ({
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
    <div className="relative inline-block">
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 rounded-xl border border-white/20 bg-black/30 px-[clamp(1rem,3vw,1.5rem)] py-[clamp(0.5rem,1.5vw,0.75rem)] text-sm font-medium text-white backdrop-blur-md transition-all hover:border-cyan-400/50 focus:outline-none"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <span className="flex items-center gap-2">
          <Users className="h-4 w-4 text-cyan-400" />
          <span className="tabular-nums">{value}</span>
          <span className="text-white/50">Players</span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-white/60 transition-transform duration-500 ${isOpen ? "rotate-180" : ""}`}
        />
      </motion.button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="absolute left-0 top-full z-20 mt-3 w-44 overflow-hidden rounded-2xl border border-white/20 bg-black/80 backdrop-blur-2xl shadow-2xl"
          >
            <div className="py-1">
              {options.map((opt) => (
                <motion.button
                  key={opt}
                  onClick={() => {
                    onChange(opt);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition-all hover:bg-white/10 ${
                    value === opt
                      ? "text-cyan-300 bg-cyan-500/10"
                      : "text-white/70"
                  }`}
                  whileHover={{
                    x: 6,
                    backgroundColor: "rgba(6, 182, 212, 0.15)",
                  }}
                >
                  <Users className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{opt}</span>
                  <span>Players</span>
                  {value === opt && (
                    <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-cyan-400" />
                  )}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// OTP Code Input – 6-Character Single Row (3 + — + 3)
// ============================================================================
interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
}
const CodeInput = ({ value, onChange, onComplete }: CodeInputProps) => {
  const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));

  const digits = useMemo(() => {
    const clean = value.replace("-", "");
    const arr = clean.split("").slice(0, 6);
    while (arr.length < 6) arr.push("");
    return arr;
  }, [value]);

  const setInputRef = useCallback(
    (index: number) => (element: HTMLInputElement | null) => {
      inputRefs.current[index] = element;
    },
    [],
  );

  const updateFullCode = useCallback(
    (newDigits: string[]) => {
    const firstPart = newDigits.slice(0, 3).join("");
    const secondPart = newDigits.slice(3, 6).join("");
    const formatted = `${firstPart}-${secondPart}`;
    onChange(formatted);
    if (newDigits.every((digit) => /^[A-Z0-9]$/.test(digit))) {
      onComplete?.(formatted);
    }
    },
    [onChange, onComplete],
  );

  const handleChange = useCallback((index: number, val: string) => {
    // السماح بالأرقام والحروف (A-Z, a-z, 0-9) وتحويل الحروف إلى uppercase
    let upperVal = val.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (upperVal.length > 1) upperVal = upperVal.slice(0, 1);
    const newDigits = [...digits];
    newDigits[index] = upperVal;
    updateFullCode(newDigits);
    if (upperVal && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }, [digits, updateFullCode]);

  const handleKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace") {
      if (digits[index] === "") {
        if (index > 0) inputRefs.current[index - 1]?.focus();
      } else {
        const newDigits = [...digits];
        newDigits[index] = "";
        updateFullCode(newDigits);
      }
      } else if (event.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
      } else if (event.key === "ArrowRight" && index < 5) {
      inputRefs.current[index + 1]?.focus();
      }
    },
    [digits, updateFullCode],
  );

  const handlePaste = useCallback((event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = event.clipboardData
      .getData("text")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const pastedArr = pasted.split("").slice(0, 6);
    const newDigits = [...digits];
    for (let index = 0; index < pastedArr.length; index += 1) {
      newDigits[index] = pastedArr[index];
    }
    updateFullCode(newDigits);
    const lastFilledIndex = newDigits.findLastIndex((digit) => digit !== "");
    const focusIndex =
      lastFilledIndex === -1 ? 0 : Math.min(lastFilledIndex + 1, 5);
    inputRefs.current[focusIndex]?.focus();
  }, [digits, updateFullCode]);

  // تصميم الحقول (بدون أي أنيميشن مزعج)
  const inputClassName = `
    rounded-lg 
    border border-white/10
    bg-black/25 
    text-center font-mono font-semibold text-white 
    shadow-[0_2px_8px_rgba(0,0,0,0.1)] 
    backdrop-blur-[2px] 
    placeholder:text-white/20 
    focus:bg-black/40 
    focus:outline-none 
    focus:ring-1 focus:ring-white/20
    w-[clamp(2.5rem,10vw,3rem)] 
    h-[clamp(2.5rem,10vw,3rem)] 
    text-[clamp(1.25rem,5vw,1.6rem)]
    transition-colors duration-150
  `;

  return (
    <div className="flex items-center justify-center gap-[clamp(0.375rem,2vw,0.625rem)]">
      {digits.slice(0, 3).map((digit, idx) => (
        <input
          key={idx}
          ref={setInputRef(idx)}
          type="text"
          inputMode="text"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={idx === 0 ? handlePaste : undefined}
          className={inputClassName}
          autoFocus={idx === 0}
        />
      ))}

      <span className="select-none px-1 text-[clamp(1.25rem,5vw,1.8rem)] font-thin text-white/20">
        —
      </span>

      {digits.slice(3, 6).map((digit, idx) => {
        const globalIdx = idx + 3;
        return (
          <input
            key={globalIdx}
            ref={setInputRef(globalIdx)}
            type="text"
            inputMode="text"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(globalIdx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(globalIdx, e)}
            className={inputClassName}
          />
        );
      })}
    </div>
  );
};


// ============================================================================
// Enhanced Ambient Oracle – Host Privileges + Dynamic Tips with Smooth Transitions
// ============================================================================
const AmbientOracle = () => {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % ambientOracleTips.length);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const CurrentIcon = ambientOracleTips[messageIndex].icon;

  return (
    <div className="inline-flex items-stretch rounded-2xl border border-white/10 bg-black/20 backdrop-blur-md overflow-hidden">
      {/* Host Privileges Badge */}
      <div className="flex items-center gap-2 bg-gradient-to-r from-amber-500/20 to-amber-600/10 px-4 py-2 border-r border-white/10">
        <Crown className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
          Host Privileges
        </span>
      </div>

      {/* Animated Tip */}
      <div className="flex items-center px-4 py-2 min-w-[240px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={messageIndex}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            className="flex items-center gap-2"
          >
            <CurrentIcon className="h-3.5 w-3.5 text-white/60" />
            <span className="text-xs font-light tracking-wide text-white/70">
              {ambientOracleTips[messageIndex].text}
            </span>
          </motion.div>
        </AnimatePresence>
        <div className="ml-3 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
      </div>
    </div>
  );
};

// ============================================================================
// Main Page Component – Perfectly Balanced Premium Lobby
// ============================================================================
export default function PvpRoomsPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState<2 | 3 | 4 | 5 | 6>(6);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const { showAlert } = useAlert();

  // Show error messages forwarded via ?error= from the room/[code] server redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error");
    if (!errorCode) return;
    const errorMessages: Record<string, string> = {
      not_found: "Room not found. The code may be wrong or the room was closed.",
      expired: "This room has expired.",
      room_closed: "This room is no longer open.",
      invalid_code: "Invalid room code format.",
    };
    const msg = errorMessages[errorCode];
    if (msg) {
      setError(msg);
      // Remove the param from the address bar without triggering navigation.
      const clean = new URL(window.location.href);
      clean.searchParams.delete("error");
      window.history.replaceState({}, "", clean.toString());
    }
  }, []);

  async function createRoom() {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/pvp/rooms/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxPlayers }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Failed to create room");
      await navigator.clipboard.writeText(body.code).catch(() => {});
      showAlert(
        `The code ${body.code} has been copied successfully! You can share it with your friends.`,
        "success",
        { durationMs: 6000 },
      );
      router.push(`/pvp/room/${body.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
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

  // const handleCodeComplete = (fullCode: string) => {
  //   // Optional auto-join
  // };

  return (
    <>
      <style jsx global>{`
        @keyframes float {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-15px);
          }
        }
        @keyframes borderFlow {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        .border-flow {
          background: linear-gradient(
            90deg,
            #00d4ff,
            #a78bfa,
            #fbbf24,
            #00d4ff
          );
          background-size: 300% 100%;
          animation: borderFlow 8s ease infinite;
        }
      `}</style>

      <div className="relative flex min-h-screen flex-col overflow-hidden">
        <Header />

        <main className="relative flex flex-1 items-center justify-center px-[clamp(1rem,5vw,2.5rem)] py-[clamp(2rem,6vw,4rem)]">
          <div className="w-full max-w-7xl">
            {/* Hero with Asymmetrical Kinetic Typography */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8 }}
              className="mb-[clamp(2.5rem,6vw,4rem)] text-center"
            >
              <div className="relative inline-block">
                <h1 className="text-[clamp(1.8rem,6vw,3.5rem)] sm:text-[clamp(2rem,7vw,4.5rem)] lg:text-[clamp(2.5rem,6vw,5rem)] font-black tracking-tighter leading-[1.15]">
                  {/* <span className="block bg-gradient-to-r from-white/90 via-cyan-300 to-blue-400 bg-clip-text text-transparent font-sfProDisplay">
                    CREATE YOUR
                  </span> */}
                  <span className="block bg-gradient-to-r from-violet-400 via-purple-300 to-cyan-400 bg-clip-text text-transparent -mt-[clamp(0.1rem,0.5vw,0.3rem)] ml-0 sm:-mt-[clamp(0.2rem,1vw,0.5rem)] sm:ml-[clamp(0.5rem,3vw,1.5rem)] font-sfProDisplay">
                    PRIVATE LOBBYS
                  </span>
                </h1>
              </div>

              {/* Enhanced Oracle placed under title */}
              <div className="mt-6 flex justify-center">
                <AmbientOracle />
              </div>
            </motion.div>

            {/* Organic Anti-Grid Layout: Asymmetrical Cards Perfectly Centered */}
            <div className="relative">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="relative mb-[clamp(1.5rem,4vw,2.5rem)] overflow-hidden rounded-2xl border border-red-500/30 bg-red-500/10 px-[clamp(1rem,3vw,1.5rem)] py-[clamp(0.75rem,2vw,1rem)] backdrop-blur-md"
                >
                  <p className="text-sm text-red-300">{error}</p>
                </motion.div>
              )}

              <div className="grid gap-[clamp(1.5rem,4vw,2.5rem)] lg:grid-cols-2">
                {/* Create Lobby Card */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.1,
                    type: "spring",
                    stiffness: 300,
                    damping: 24,
                  }}
                  className="flex"
                >
                  <GlassCard
                    glowColor="cyan"
                    depth="elevated"
                    className="h-full w-full"
                  >
                    <div className="relative p-[clamp(1.5rem,5vw,2.5rem)]">
                      <div className="mb-[clamp(1.5rem,4vw,2.25rem)] flex items-center gap-4">
                        <div className="rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 p-3">
                          <Sparkles className="h-6 w-6 text-cyan-300" />
                        </div>
                        <div>
                          <h2 className="text-[clamp(1.25rem,4vw,2rem)] font-bold tracking-tight text-white">
                            New Lobby
                          </h2>
                          <p className="text-[clamp(0.7rem,1.5vw,0.85rem)] text-white/40">
                            Host a private game session
                          </p>
                        </div>
                      </div>

                      <div className="space-y-[clamp(1.5rem,4vw,2rem)]">
                        <div>
                          <label className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/50">
                            <Users className="h-4 w-4" />
                            Party Size
                          </label>
                          <FluidSelect
                            value={maxPlayers}
                            onChange={(val) =>
                              setMaxPlayers(val as typeof maxPlayers)
                            }
                            options={[2, 3, 4, 5, 6]}
                          />
                          <p className="mt-2 flex items-center gap-1 text-[11px] text-white/30">
                            <Wifi className="h-3 w-3" /> Host controls match
                            start
                          </p>
                        </div>

                        <Button
                          onClick={createRoom}
                          disabled={isCreating}
                          className="w-full py-5 btn-main"
                        >
                          {isCreating ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4" />
                              Create Room
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>

                {/* Join Lobby Card */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.2,
                    type: "spring",
                    stiffness: 300,
                    damping: 24,
                  }}
                  className="flex"
                >
                  <GlassCard
                    glowColor="purple"
                    depth="default"
                    className="h-full w-full"
                  >
                    <div className="relative p-[clamp(1.5rem,5vw,2.5rem)]">
                      <div className="mb-[clamp(1.5rem,4vw,2rem)] flex items-center gap-4">
                        <div className="rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 p-3">
                          <DoorOpen className="h-5 w-5 text-purple-300" />
                        </div>
                        <div>
                          <h2 className="text-[clamp(1.25rem,4vw,1.75rem)] font-bold tracking-tight text-white">
                            Join Friend
                          </h2>
                          <p className="text-[clamp(0.65rem,1.5vw,0.8rem)] text-white/40">
                            Enter the 6‑letter passcode
                          </p>
                        </div>
                      </div>

                      <div className="space-y-[clamp(1.5rem,4vw,2rem)]">
                        <div>
                          <label className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/50">
                            <Hash className="h-4 w-4" />
                            Room Code
                          </label>
                          <CodeInput
                            value={code}
                            onChange={setCode}
                            // onComplete={handleCodeComplete}
                          />
                        </div>

                        <Button
                          onClick={joinRoom}
                          disabled={code.length !== 7 || isJoining}
                          className="w-full py-5 btn-purple"
                        >
                          {isJoining ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Joining...
                            </>
                          ) : (
                            <>
                              <ArrowRight className="mr-2 h-4 w-4" />
                              Join Arena
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
