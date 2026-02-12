"use client";

// Core imports
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Components
import { SettingsDialog } from "@/components/settings-dialog";

// Icons & Assets
import { HiOutlineMenu, HiX } from "react-icons/hi";
import { FaUserCircle } from "react-icons/fa";
import { LevelIcon } from "@/assets";

// hooks
import { useLevel } from "@/features/level/hooks/useLevel";
import { usePathname, useRouter } from "next/navigation";

import { DailyChallenge } from "./DailyChallenge";

import { ProgressBar } from "@/components/ui/ProgressBar";
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
 * Shows user's level with animated progress bar and tooltip
 */
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

      <div className="hidden md:flex items-center gap-2 xl:bg-gradient-to-br xl:border xl:shadow-lg xl:px-3 xl:py-1.5 from-slate-900 to-slate-800 border-slate-700 rounded-full transition-all duration-300">
        <div className="hidden lg:block relative w-7 h-7">
          <Image
            src={LevelIcon}
            fill
            alt="Level Icon"
            className="object-contain"
          />

          {isBootstrapping ? (
            <Skeleton className="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border-slate-600/40" />
          ) : (
            <span
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 
              ${String(userLevel).length === 3 ? "text-sm" : "text-base"}
              font-extrabold
              bg-gradient-to-b from-blue-300 to-blue-200 bg-clip-text text-transparent`}
              style={{
                textShadow: `0 0 10px rgba(34,211,238,0.8), 0 0 25px rgba(34,211,238,0.6), 0 0 35px rgba(34,211,238,0.4)`,
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
                  <Skeleton className="h-3 w-12 rounded-full" />
                  <Skeleton className="h-3 w-16 rounded-full" />
                </div>
                <Skeleton className="h-1.5 w-28 rounded-full bg-slate-700/40 border-slate-600/30" />
              </>
            ) : (
              <>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-blue-300">{userXP.toLocaleString()}</span>
                  <span className="text-slate-400 pl-1">
                    / {nextLevelXP.toLocaleString()} XP
                  </span>
                </div>
                <div className="relative w-28 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <ProgressBar progress={progressPercentage} />
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

  const getMessageStyle = (type: XPMessageType) => {
    const base =
      "mb-1 px-3 py-2 bg-slate-800/90 backdrop-blur-sm rounded-full text-xs shadow-lg text-center w-full drop-shadow-messageGlow";

    const styles: Record<XPMessageType, string> = {
      base: `${base} text-blue-300 `,
      "daily-challenge": `${base} text-emerald-200`,
      achievement: `${base} text-purple-200`,
      bonus: `${base} text-emerald-200`,
      "level-up": `${base} text-emerald-200 `,
      participation: `${base} text-slate-200`,
      error: `${base} bg-red-800 text-red-200`,
      
    };

    return styles[type] || `${base} bg-slate-800 text-slate-200`;
  };

  const getMessageStyleByMessage = (type: XPMessageType, text: string) => {
    if (type !== "bonus") return getMessageStyle(type);

    const lowered = text.toLowerCase();
    const isEndurance =
      lowered.includes("endurance") ||
      lowered.includes("character") ||
      lowered.includes("marathon") ||
      lowered.includes("long");

    if (!isEndurance) return getMessageStyle(type);

    return (
      "mb-1 px-3 py-2 bg-gradient-to-r from-amber-500/15 via-emerald-500/10 to-cyan-500/15 " +
      "backdrop-blur-sm rounded-full text-xs shadow-lg text-center w-full drop-shadow-messageGlow text-amber-100 " +
      "border border-amber-400/20"
    );
  };

  return (
    <div className="absolute top-[calc(100%+10px)] left-1/2 -translate-x-1/2 w-[200px] z-50">
      <div className="flex flex-col-reverse items-center">
        <AnimatePresence>
          {xpMessages.map((msg, index) => (
            <motion.div
              key={msg.id}
              layout
              initial={{ opacity: 0, y: -40, scale: 0.85 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                transition: {
                  type: "spring",
                  stiffness: 250,
                  damping: 25,
                  mass: 0.6,
                },
              }}
              exit={{
                opacity: 0,
                y: -40,
                scale: 0.8,
                transition: {
                  duration: 0.3,
                  ease: [0.4, 0, 0.2, 1],
                },
              }}
              transition={{
                type: "spring",
                stiffness: 250,
                damping: 25,
                mass: 0.6,
                delay: index * 0.1,
              }}
              className={getMessageStyleByMessage(msg.type, msg.text)}
            >
              {msg.text}
              <span className="font-mono text-sm">
                {" "}
                +{msg.value.toLocaleString()}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
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
  const router = useRouter();
  const pathname = usePathname();

  const handleAuthNavigation = (formType: "login" | "signup") => {
    const target = `/auth?form=${formType}`;
    // If we're already on the auth page, replace to switch forms without stacking history.
    if (pathname === "/auth") {
      router.replace(target);
      return;
    }
    router.push(target);
  };

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
            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-slate-200 hover:text-white"
            aria-label="Profile"
          >
            <FaUserCircle className="w-5 h-5" />
          </Link>

          {/* Settings Dialog */}
          {/* IDEA: Added a feature to improve the application */}
          {/* Future feature: Language change */}

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
