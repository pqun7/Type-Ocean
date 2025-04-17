"use client";

// Core imports
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";

// Components
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { SettingsDialog } from "@/components/settings-dialog";

// Icons & Assets
import { HiOutlineMenu, HiX } from "react-icons/hi";
import { FaUserCircle } from "react-icons/fa";
import { LevelIcon } from "@/assets";

// Context
import { useLevel } from "@/contexts/hook/useLevel";
import { useState } from "react";

import { DailyChallenge } from "./DailyChallenge";

// Type definition for component props
interface UserMenuProps {
  isLoggedIn: boolean;
  toggleMenu: () => void;
  isMenuOpen: boolean;
  userLevel: number;
  userXP: number;
  nextLevelXP: number;
}
import { XPMessageType } from "@/types/level";

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
  const progressPercentage = Math.min((userXP / nextLevelXP) * 100, 100);

  return (
    <div className="relative flex items-center gap-4">
      {/* Daily Challenge - مستقلة عن المجموعة */}
      <div>
        <DailyChallenge />
      </div>

      {/* Level & XP Progress - داخل group فقط لوحده */}
      <div className="relative group overflow-visible hidden md:flex items-center gap-2 xl:bg-gradient-to-br from-slate-900 to-slate-800 xl:border border-slate-700 rounded-full px-3 py-1.5 xl:shadow-lg transition-all duration-300">
        {/* Level Icon */}
        <div className="flex items-center gap-2">
          <div className="relative w-7 h-7 hidden lg:block">
            <Image
              src={LevelIcon}
              layout="fill"
              objectFit="contain"
              alt="Level Icon"
            />
            <span
              className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
                ${String(userLevel).length === 3 ? "text-sm" : "text-base"}
                font-black 
                bg-gradient-to-b from-blue-300 to-blue-200 bg-clip-text text-transparent mix-blend-light`}
              style={{
                textShadow: `0 0 10px rgba(34,211,238,0.8), 0 0 25px rgba(34,211,238,0.6), 0 0 35px rgba(34,211,238,0.4)`,
              }}
            >
              {userLevel}
            </span>
          </div>
        </div>

        {/* XP Progress */}
        <div className="hidden xl:flex flex-col ml-1">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-blue-300">{userXP.toLocaleString()}</span>
            <span className="text-slate-400">/ {nextLevelXP.toLocaleString()} XP</span>
          </div>
          <div className="relative w-28 h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-blue-500 to-blue-400"
              animate={{ width: `${progressPercentage}%` }}
              transition={{ type: "spring", stiffness: 100, damping: 15 }}
            />
          </div>
        </div>

        {/* <div className="absolute hidden group-hover:block top-full mt-2 left-1/2 transform -translate-x-1/2 px-8 py-2 bg-slate-800 text-xs text-white rounded-md shadow-lg ">
          Progress: {progressPercentage.toFixed(1)}%
        </div> */}
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
    };

    return styles[type] || `${base} bg-slate-800 text-slate-200`;
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
              className={getMessageStyle(msg.type)}
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
    className={`p-2 rounded-lg text-slate-300 transition-all duration-200 sm:hidden ${
      isMenuOpen
        ? "hover:text-red-400 bg-slate-800/30"
        : "hover:text-white hover:bg-slate-800/50"
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
  toggleMenu,
  isMenuOpen,
  userLevel,
  userXP,
  nextLevelXP,
}) => {
  return (
    <div className="flex items-center gap-3">
      {isLoggedIn ? (
        /* Authenticated User Section */
        <div className="hidden sm:flex items-center gap-3">
          <UserLevelDisplay
            userLevel={userLevel}
            userXP={userXP}
            nextLevelXP={nextLevelXP}
          />

          {/* Profile Link */}
          <Link
            href="/profile"
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-slate-200 hover:text-white"
            aria-label="Profile"
          >
            <FaUserCircle className="w-5 h-5" />
          </Link>

          {/* Settings Dialog */}
          {/* IDEA: Added a feature to improve the application */}
          {/* Future feature: Language change */}

          <SettingsDialog />
        </div>
      ) : (
        /* Guest User Section */
        <HoverBorderGradient
          containerClassName="rounded-full"
          bgColor="bg-transparent"
          className="px-5 py-2 text-sm font-medium text-white bg-slate-900/50 hover:bg-slate-800/70 transition-all duration-300 hidden sm:flex items-center justify-center"
        >
          <Link href="/login">Sign In</Link>
        </HoverBorderGradient>
      )}

      {/* Mobile Menu Toggle */}
      <MobileMenuButton isMenuOpen={isMenuOpen} toggleMenu={toggleMenu} />
    </div>
  );
};

export default UserMenu;
