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
import { GearIcon, AvatarIcon } from "@radix-ui/react-icons";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";
import { navigation } from "@/constants";
import {
  SPRING_CONFIG,
  SCROLL_RANGE,
  MOBILE_MENU_TRANSITION,
} from "@/constants/constants";

interface NavigationProps {
  scrollY: MotionValue<number>;
}

export const DesktopNavigation: React.FC<NavigationProps> = ({ scrollY }) => {
  const navOpacity = useSpring(
    useTransform(scrollY, SCROLL_RANGE, [1, 0.95]),
    SPRING_CONFIG
  );
  const filteredNavigation = navigation.filter((item) => !item.onlyMobile);

  return (
    <motion.nav
      style={{ opacity: navOpacity }}
      className="hidden pl-6 space-x-6 sm:flex md:items-center sm:w-full md:px-10 xl:px-32 justify-center"
    >
      {filteredNavigation.map((item) => (
        <motion.div key={item.id}>
          <Link
            href={item.url}
            className="relative text-sm font-medium text-slate-300 hover:text-white transition-colors"
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
}

export const UserMenu: React.FC<UserMenuProps> = ({
  isLoggedIn,
  toggleMenu,
  isMenuOpen,
}) => {
  const menuButtonClasses = `p-2 sm:hidden rounded-lg transition-colors text-slate-300 ${
    isMenuOpen ? "hover:text-red-400" : "hover:text-white hover:bg-white/10"
  }`;

  return (
    <div className="flex items-center gap-4 ml-4">
      {isLoggedIn ? (
        <div className="sm:flex items-center gap-4 hidden">
          <Link
            href="/profile"
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-slate-300 hover:text-white"
            aria-label="Profile"
          >
            <AvatarIcon className="w-6 h-6" />
          </Link>

          <Link
            href="/settings"
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-slate-300 hover:text-white"
            aria-label="Settings"
          >
            <GearIcon className="w-6 h-6" />
          </Link>
        </div>
      ) : (
        <HoverBorderGradient
          containerClassName="rounded-full"
          className="px-6 py-2 font-medium bg-white/5 backdrop-blur-sm hover:bg-white/10 h-9 hidden sm:flex items-center justify-center transition-colors text-white"
        >
          <Link href="/login" className="h-fit text-sm text-nowrap">Sign In</Link>
        </HoverBorderGradient>
      )}

      <button
        onClick={toggleMenu}
        aria-label={isMenuOpen ? "Close menu" : "Open menu"}
        aria-expanded={isMenuOpen}
        className={menuButtonClasses}
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

interface MobileNavigationProps {
  isMenuOpen: boolean;
  setIsMenuOpen: (open: boolean) => void;
  isLoggedIn: boolean;
  scrollY: MotionValue<number>;
}

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
