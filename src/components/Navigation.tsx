"use client";
import Link from "next/link";
import {
  motion,
  useSpring,
  useTransform,
  AnimatePresence,
  type MotionValue,
} from "framer-motion";
import { HiOutlineMenu, HiX } from "react-icons/hi";
import { GearIcon } from "@radix-ui/react-icons";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { navigation } from "@/constants";
import { FaUserCircle } from "react-icons/fa";
import { FiAward } from "react-icons/fi";
import { LevelIcon } from "@/assets";
import Image from "next/image";
import {
  SPRING_CONFIG,
  SCROLL_RANGE,
  MOBILE_MENU_TRANSITION,
} from "@/constants/constants";
import { SettingsDialog } from "@/components/settings-dialog";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface NavigationProps {
  scrollY: MotionValue<number>;
}

interface UserMenuProps {
  isLoggedIn: boolean;
  toggleMenu: () => void;
  isMenuOpen: boolean;
  userLevel: number;
  userXP: number;
  nextLevelXP: number;
}

interface MobileNavigationProps {
  isMenuOpen: boolean;
  setIsMenuOpen: (open: boolean) => void;
  isLoggedIn: boolean;
  scrollY: MotionValue<number>;
}

export const DesktopNavigation: React.FC<NavigationProps> = ({ scrollY }) => {
  const navOpacity = useSpring(
    useTransform(scrollY, SCROLL_RANGE, [1, 0.95]),
    SPRING_CONFIG
  );
  const filteredNavigation = navigation.filter((item) => !item.onlyMobile);

  return (
    <motion.nav className="hidden pl-6 lg:space-x-8 space-x-2 sm:flex md:items-center sm:w-full md:px-2 xl:px-16 justify-center">
      {filteredNavigation.map((item) => (
        <motion.div key={item.id} whileHover={{ scale: 1.05 }}>
          <Link
            href={item.url}
            className="relative text-sm font-medium text-slate-300 hover:text-white transition-all duration-300 px-1 py-2 rounded-lg hover:bg-white/5"
          >
            {item.title}
          </Link>
        </motion.div>
      ))}
    </motion.nav>
  );
};

interface UserMenuProps {
  isLoggedIn: boolean;
  toggleMenu: () => void;
  isMenuOpen: boolean;
  userLevel: number;
  userXP: number;
  nextLevelXP: number;
}

export const UserMenu: React.FC<UserMenuProps> = ({
  isLoggedIn,
  toggleMenu,
  isMenuOpen,
  userLevel,
  userXP,
  nextLevelXP,
}) => {
  const progressPercentage = Math.min((userXP / nextLevelXP) * 100, 100);

  return (
    <div className="flex items-center gap-3">
      {isLoggedIn ? (
        <div className="hidden sm:flex items-center gap-3">
          {/* مستوى المستخدم المحسن */}
          <div className="relative group">
            <div className="hidden md:flex items-center gap-2 bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-full px-3 py-1.5 shadow-lg shadow-blue-500/10 hover:shadow-blue-500/20 transition-all duration-300">
              {/* <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/20">
                <FiAward className="w-3 h-3 text-blue-400" />
                <span
                  className="text-base font-bold bg-gradient-to-b from-cyan-300 to-blue-400 
                     bg-clip-text text-transparent transform"
                >
                  1
                </span>
              </div> */}

              <div className="relative w-6 h-6">
                <Image
                  className="w-full h-full"
                  src={LevelIcon}
                  layout="fill"
                  objectFit="contain"
                  alt="Level Icon"
                />
                <span
                  className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
               text-base font-bold bg-gradient-to-b from-cyan-200 to-blue-500 
               bg-clip-text text-transparent "
                >
                  1
                </span>
              </div>

              {/* <span className="text-sm font-bold text-blue-400">
                Lv.{userLevel}
              </span> */}

              <div className="hidden xl:flex flex-col ml-1">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-blue-300">{userXP} XP</span>
                  <span className="text-slate-400">/ {nextLevelXP} XP</span>
                </div>

                <div className="relative w-28 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-blue-500 to-blue-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercentage}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-blue-500/30 to-blue-400/30"
                    style={{
                      width: `${100 - progressPercentage}%`,
                      left: `${progressPercentage}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* تلميح عند التحويم */}
            <div className="absolute hidden group-hover:block top-full mt-2 left-1/2 transform -translate-x-1/2 px-3 py-2 bg-slate-800 text-xs text-white rounded-md shadow-lg whitespace-nowrap">
              Progress: {progressPercentage.toFixed(1)}%
            </div>
          </div>

          {/* أيقونة الملف الشخصي */}
          <Link
            href="/profile"
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-slate-200 hover:text-white"
            aria-label="Profile"
          >
            <FaUserCircle className="w-5 h-5" />
          </Link>

          {/* إعدادات */}
          <SettingsDialog />
        </div>
      ) : (
        <HoverBorderGradient
          containerClassName="rounded-full"
          bgColor="bg-transparent"
          className="px-5 py-2 text-sm font-medium text-white bg-slate-900/50 hover:bg-slate-800/70 transition-all duration-300 hidden sm:flex items-center justify-center"
        >
          <Link href="/login">Sign In</Link>
        </HoverBorderGradient>
      )}

      {/* زر القائمة للجوال */}
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
    </div>
  );
};

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  isMenuOpen,
  setIsMenuOpen,
  scrollY,
  isLoggedIn,
}) => {
  const marginAdjust = useSpring(
    useTransform(scrollY, SCROLL_RANGE, [0, -40]),
    SPRING_CONFIG
  );
  const filteredNavigation = navigation.filter(
    (item) => !(isLoggedIn && item.isLoggedIn === false)
  );

  return (
    <>
      <motion.div
        className="fixed top-0 right-0 h-screen w-full sm:hidden z-30"
        initial={{ x: "100%" }}
        animate={{ x: isMenuOpen ? 0 : "100%" }}
        style={{ marginLeft: marginAdjust, marginTop: marginAdjust }}
        transition={MOBILE_MENU_TRANSITION}
      >
        <div className="flex items-center justify-center w-full h-full">
          <motion.nav
            initial={{ opacity: 0 }}
            animate={{ opacity: isMenuOpen ? 1 : 0 }}
            transition={MOBILE_MENU_TRANSITION}
            className="z-30 flex flex-col items-center justify-center lg:flex-row"
          >
            {filteredNavigation.map((item) => (
              <Link
                key={item.id}
                href={item.url}
                className="block px-6 py-6 text-2xl text-white uppercase transition-colors hover:text-slate-200"
                onClick={() => setIsMenuOpen(false)}
              >
                {item.title}
              </Link>
            ))}
          </motion.nav>
        </div>
      </motion.div>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0, filter: "blur(0px)" }}
            animate={{ opacity: 0.7, filter: "blur(24px)" }}
            exit={{ opacity: 0, filter: "blur(0px)" }}
            transition={MOBILE_MENU_TRANSITION}
            className="h-screen w-screen sm:hidden fixed inset-0 bg-black bg-opacity-70 z-20"
            onClick={() => setIsMenuOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
};

const DialogSettings = () => (
  <Dialog>
    <DialogTrigger asChild>
      <button
        className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-slate-300 hover:text-white"
        aria-label="Settings"
      >
        <GearIcon className="w-6 h-6" />
      </button>
    </DialogTrigger>
    <DialogContent className="sm:max-w-[425px] bg-slate-900 border-slate-700">
      <DialogHeader>
        <DialogTitle className="text-white">Settings</DialogTitle>
      </DialogHeader>
      <div className="p-6 space-y-4">
        {/* Your settings content here */}
        <p className="text-slate-300">Settings content goes here...</p>
      </div>
    </DialogContent>
  </Dialog>
);
