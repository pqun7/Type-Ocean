"use client";

// Core imports
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";

// Components
import { SettingsDialog } from "@/components/settings-dialog";
import { useSettings } from "@/features/settings/context";

// Icons & Assets
import { HiOutlineMenu, HiX } from "react-icons/hi";
import { LevelIcon } from "@/assets";

// hooks
import { useLevel } from "@/features/level/hooks/useLevel";
import { useUserAvatar } from "@/features/auth/hooks/useUserAvatar";
import { useUserSession } from "@/features/auth/hooks/useUserSession";
import { usePathname, useRouter } from "next/navigation";

import { DailyChallenge } from "./DailyChallenge";

import { Skeleton } from "@/components/ui/skeleton";

      


// Type definition for component props
interface UserMenuProps {
  isLoggedIn: boolean;
  isAuthLoading?: boolean;
  toggleMenu: () => void;
  isMenuOpen: boolean;
  userLevel: number;
  userXP: number;
  nextLevelXP: number;
}
import { XPMessageType } from "@/features/level/types/level";
/**
 * UserLevelDisplay Component
 * Shows user's level with animated progress bar, tooltip, and XP messages
 */
const UserLevelDisplay = ({
  userLevel,
  userXP,
  nextLevelXP,
}: Pick<UserMenuProps, "userLevel" | "userXP" | "nextLevelXP">) => {
  const { isLoadingSession } = useLevel();
  const isBootstrapping = !!isLoadingSession;
  const progressPercentage =
    nextLevelXP > 0 ? Math.min((userXP / nextLevelXP) * 100, 100) : 0;

  return (
    <div className="relative flex items-center gap-4">
      <div className="hidden lg:flex">
        <DailyChallenge className="relative items-center gap-2" />
      </div>

    <div className="hidden md:flex items-center gap-2 rounded-full transition-all duration-300 xl:bg-gradient-to-br xl:from-slate-900/30 xl:to-slate-800/30 xl:backdrop-blur-sm xl:border xl:border-[rgba(160,220,255,0.15)] xl:shadow-xl xl:px-3 xl:py-1.5 hover:border-[rgba(160,220,255,0.3)]" >
        <div className="hidden lg:block relative w-7 h-7">
          <Image
            src={LevelIcon}
            fill
            alt="Level Icon"
            className="object-contain"
          />

          {isBootstrapping ? (
            <Skeleton className="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white/10" />
          ) : (
            <span
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 
              ${String(userLevel).length === 3 ? "text-sm" : "text-base"}
              font-extrabold
              bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent`}
              style={{
                textShadow: `0 0 10px rgba(34,211,238,0.8), 0 0 25px rgba(34,211,238,0.6)`,
              }}
            >
              {userLevel}
            </span>
          )}
        </div>

        {/* XP Progress */}
        <div className="hidden xl:flex flex-col ml-1.5">
          {isBootstrapping ? (
            <>
              <div className="flex justify-between text-xs mb-1 gap-2">
                <Skeleton className="h-3 w-12 rounded-full bg-white/10" />
                <Skeleton className="h-3 w-16 rounded-full bg-white/10" />
              </div>
              <Skeleton className="h-1.5 w-28 rounded-full bg-white/10" />
            </>
          ) : (
            <>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-cyan-300">{userXP.toLocaleString()}</span>
                <span className="text-[#8A8FB5] pl-1">
                  / {nextLevelXP.toLocaleString()} XP
                </span>
              </div>
              <div className="relative w-28 h-1.5 bg-slate-700/30 rounded-full overflow-hidden group">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full transition-all duration-500 ease-out group-hover:shadow-[0_0_8px_#60a5fa]"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <XPMessages />
    </div>
  );
};

const XPMessages = () => {
  const { xpMessages } = useLevel();
  const { settings } = useSettings();

  // Resolve base style class per message type – متوافقة مع تصميم المرجع
  const getBaseStyle = useCallback((type: XPMessageType): string => {
    const pill = "mb-1 px-3 py-2 rounded-full border text-xs text-center w-full backdrop-blur shadow-sm";

    const map: Record<XPMessageType, string> = {
      base:              `${pill} border-white/10 bg-white/5 text-[#E0E7FF]`,
      participation:     `${pill} border-white/10 bg-white/5 text-[#E0E7FF]`,
      "daily-challenge": `${pill} border-emerald-400/20 bg-emerald-500/5 text-emerald-200`,
      bonus:             `${pill} border-emerald-400/20 bg-emerald-500/5 text-emerald-200`,
      "level-up":        `${pill} border-emerald-400/20 bg-emerald-500/5 text-emerald-200`,
      achievement:       `${pill} border-purple-400/25 bg-purple-500/8 text-purple-200`,
      error:             `${pill} bg-red-950/40 text-red-200 border-red-500/25`,
      "personal-best":   `${pill} border-cyan-400/30 bg-gradient-to-r from-cyan-500/10 via-sky-400/5 to-blue-500/10 text-cyan-100`,
      mythic:            `${pill} border-violet-400/45 bg-gradient-to-r from-violet-600/20 via-purple-500/15 to-fuchsia-600/15 text-violet-100`,
      "pvp-win":         `${pill} border-blue-400/25 bg-blue-500/8 text-blue-100`,
      "pvp-streak":      `${pill} border-red-400/40 bg-gradient-to-r from-red-600/15 via-orange-500/10 to-red-600/15 text-red-100`,
    };

    return map[type] ?? `${pill} border-white/10 bg-white/5 text-[#E0E7FF]`;
  }, []);

  const resolveStyle = useCallback((type: XPMessageType, text: string, value: number): string => {
    if (type === "bonus") {
      const lowered = text.toLowerCase();
      const isEndurance =
        lowered.includes("endurance") ||
        lowered.includes("character") ||
        lowered.includes("marathon") ||
        lowered.includes("long");
      if (isEndurance) {
        return (
          "mb-1 px-3 py-2 rounded-lg text-xs text-center w-full backdrop-blur shadow-sm " +
          "bg-gradient-to-r from-amber-500/10 via-emerald-500/5 to-cyan-500/10 " +
          "border border-white/10 text-amber-100"
        );
      }
    }

    let cls = getBaseStyle(type);

    if ((type === "mythic" || type === "personal-best") && value >= 150) {
      cls += " text-sm font-semibold";
    }
    if (type === "mythic" && value >= 300) {
      cls += " shadow-[0_0_20px_rgba(139,92,246,0.35)]";
    }

    return cls;
  }, [getBaseStyle]);

  const styledMessages = useMemo(
    () => xpMessages.map((msg) => ({ ...msg, cls: resolveStyle(msg.type, msg.text, msg.value) })),
    [xpMessages, resolveStyle]
  );

  const useFancyAnimation = xpMessages.length <= 2;

  return (
    <div className="absolute top-[calc(100%+10px)] left-[calc(50%+0.5rem)] md:left-[calc(50%+1rem)] -translate-x-1/2 w-[200px] z-50">
      <div className="flex flex-col items-center">
        {settings.reduceMotion ? (
          <>
            {styledMessages.map((msg) => (
              <div key={msg.id} className={msg.cls}>
                {msg.text}
                <span className="font-mono text-sm"> +{msg.value.toLocaleString()}</span>
              </div>
            ))}
          </>
        ) : (
          <AnimatePresence mode="popLayout">
            {styledMessages.map((msg) => {
              const isMythic = msg.type === "mythic";
              const isPB     = msg.type === "personal-best";
              const initScale = (isMythic && useFancyAnimation) ? 0.90 : 0.98;
              const fancy = (isMythic || isPB) && useFancyAnimation;

              return (
                <motion.div
                  key={msg.id}
                  layout
                  initial={{ opacity: 0, y: -18, scale: initScale }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -18, scale: initScale }}
                  transition={
                    fancy
                      ? {
                          y:       { type: "spring", stiffness: 240, damping: 20, mass: 0.8 },
                          opacity: { duration: 0.18, ease: "easeOut" },
                          scale:   { duration: 0.18, ease: "easeOut" },
                        }
                      : {
                          y:       { type: "spring", stiffness: 150, damping: 28, mass: 0.9 },
                          opacity: { duration: 0.2,  ease: "easeOut" },
                          scale:   { duration: 0.2,  ease: "easeOut" },
                        }
                  }
                  className={msg.cls}
                >
                  {msg.text}
                  <span className="font-mono text-sm">
                    {" "}
                    +{msg.value.toLocaleString()}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};

/**
 * MobileMenuButton Component
 * Toggle button for mobile navigation
 */
const MobileMenuButton = ({
  isMenuOpen,
  toggleMenu,
}: Pick<UserMenuProps, "isMenuOpen" | "toggleMenu">) => (
  <button
    onClick={toggleMenu}
    aria-label={isMenuOpen ? "Close menu" : "Open menu"}
    className={`p-2 rounded-lg text-slate-300 transition-colors duration-200 sm:hidden
    ${
      isMenuOpen
        ? "bg-slate-800/30 hover:text-red-400"
        : "hover:bg-slate-800/50 hover:text-white"
    }`}
  >
    {isMenuOpen ? (
      <HiX className="w-6 h-6" />
    ) : (
      <HiOutlineMenu className="w-6 h-6" />
    )}
  </button>
);
const UserMenu: React.FC<UserMenuProps> = ({
  isLoggedIn,
  isAuthLoading,
  toggleMenu,
  isMenuOpen,
  userLevel,
  userXP,
  nextLevelXP,
}) => {
  const { isAdmin } = useUserSession();
  const router = useRouter();
  const pathname = usePathname();

  const { avatarUrl: profileAvatarUrl, username: profileUsername } = useUserAvatar(isLoggedIn);

  const handleAuthNavigation = useCallback((formType: "login" | "signup") => {
    const target = `/auth?form=${formType}`;
    // If we're already on the auth page, replace to switch forms without stacking history.
    if (pathname === "/auth") {
      router.replace(target);
      return;
    }
    router.push(target);
  }, [pathname, router]);

  return (
    <div className="flex items-center gap-3">
      {isLoggedIn ? (
        /* Authenticated User Section */
        <div className="hidden sm:flex items-center gap-4">
          <UserLevelDisplay
            userLevel={userLevel}
            userXP={userXP}
            nextLevelXP={nextLevelXP}
          />

          {/* Profile Link */}
          <Link
            href="/profile"
            className="p-2"
            aria-label="Profile"
          >
            <div
              className={
                "rounded-full ring-2 ring-offset-2 ring-offset-slate-950 transition-all duration-300 " +
                "ring-[rgba(160,220,255,0.3)] hover:ring-[rgba(160,220,255,0.6)]"
              }
            >
              <UserAvatar
                username={profileUsername}
                avatarUrl={profileAvatarUrl}
                alt="Profile avatar"
                className="h-8 w-8 rounded-full border border-white/10 bg-white/5"
                fallbackClassName="text-[10px] font-semibold text-slate-200"
              />
            </div>
          </Link>

          {/* Settings Dialog */}
          {/* IDEA: Added a feature to improve the application */}
          {/* Future feature: Language change */}

          {isAdmin ? (
            <Link
              href="/admin"
              className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-400/20"
            >
              Admin
            </Link>
          ) : null}

          <SettingsDialog />
        </div>
      ) : isAuthLoading ? (
        // Auth state unknown yet: avoid flashing logged-out buttons.
        <div className="hidden sm:flex items-center gap-4">
          <div className="h-9 w-28 rounded-full bg-slate-800/40 border border-slate-700/40 animate-pulse" />
          <div className="h-9 w-9 rounded-lg bg-slate-800/40 border border-slate-700/40 animate-pulse" />
        </div>
      ) : (
        <div className="hidden sm:flex gap-4">
          
          {/* Sign Up Button */}
          <Button
            variant="outline"
            className={cn(
              "hidden lg:flex font-medium rounded-full px-4 sm:px-6 py-2",
              "border border-indigo-300/40 hover:border-indigo-300/70",
              "bg-white/5 hover:bg-indigo-300/10",
              "text-indigo-300 hover:text-indigo-200",
              "backdrop-blur-sm",
              "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
              "focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0a1f]/50"
            )}
            onClick={() => handleAuthNavigation("signup")}
          >
            Sign up
          </Button>

          {/* Sign In Button */}
          <Button
            variant="outline"
            className={cn(
              "rounded-full px-4 sm:px-6 py-2 font-medium flex",
              "border border-[#69d0ff]/60 hover:border-[#69d0ff]",
              "bg-blue-900/20 hover:bg-blue-900/30", 
              "text-[#69d0ff] hover:text-[#b3e9ff]",
              "backdrop-blur-sm",
              "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
              "focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0a1f]/50"
              
            )}
            onClick={() => handleAuthNavigation("login")}
          >
            Login
          </Button>

        </div>
      )}

      {/* Mobile Menu Toggle */}
      <MobileMenuButton isMenuOpen={isMenuOpen} toggleMenu={toggleMenu} />
    </div>
  );
};

export default UserMenu;
