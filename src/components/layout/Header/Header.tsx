"use client";
import { useState, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useMotionTemplate,
  type MotionValue,
} from "framer-motion";
import {
  UserMenu,
  MobileNavigation,
  DesktopNavigation,
} from "@/components/layout/Header";
import { brainwaveSymbol } from "@/assets";
import { SPRING_CONFIG, SCROLL_RANGE } from "@/constants/constants";
import { useLevel } from "@/features/level/hooks/useLevel";

function useAnimatedHeaderNumber(
  scrollY: MotionValue<number>,
  outputRange: [number, number]
): MotionValue<number> {
  return useSpring(useTransform(scrollY, SCROLL_RANGE, outputRange), SPRING_CONFIG);
}

function useAnimatedHeaderString(
  scrollY: MotionValue<number>,
  outputRange: [string, string]
): MotionValue<string> {
  return useTransform(scrollY, SCROLL_RANGE, outputRange);
}

const Header: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();

  const headerWidth = useAnimatedHeaderString(scrollY, ["100%", "75%"]);
  const headerBorderRadius = useAnimatedHeaderNumber(scrollY, [0, 9999]);
  const headerOpacity = useAnimatedHeaderNumber(scrollY, [1, 0.95]);
  const backdropBlur = useAnimatedHeaderNumber(scrollY, [0, 2]);
  const borderOpacity = useAnimatedHeaderNumber(scrollY, [0, 0.3]);
  const logoTranslateX = useAnimatedHeaderNumber(scrollY, [0, 10]);
  const userMenuTranslateX = useAnimatedHeaderNumber(scrollY, [0, -5]);
  const backgroundAlpha = useAnimatedHeaderNumber(scrollY, [0, 0.05]);

  const toggleMenu = useCallback(() => setIsMenuOpen((prev) => !prev), []);

  const backdropFilterValue = useMotionTemplate`blur(${backdropBlur}px)`;
  const borderValue = useMotionTemplate`1px solid rgba(148, 163, 184, ${borderOpacity})`;
  const backgroundColorValue = useMotionTemplate`rgba(255, 255, 255, ${backgroundAlpha})`;

  const { level, userXP, nextLevelXP, userId, isAuthLoading } = useLevel();
  const isLoggedIn = useMemo(() => !!userId, [userId]);

  return (
    <>
      <motion.header
        role="banner"
        ref={headerRef}
        style={{
          width: headerWidth,
          borderRadius: headerBorderRadius,
          opacity: headerOpacity,
          backdropFilter: backdropFilterValue,
          WebkitBackdropFilter: backdropFilterValue,
          border: borderValue,
          backgroundColor: backgroundColorValue,
        }}
        className="fixed top-0 left-0 right-0 z-50 mx-auto h-16 mt-2 border border-slate-300"
      >
        <div className="flex items-center h-full px-2 lg:px-4">
          <motion.div
            style={{ translateX: logoTranslateX }}
            className="z-10 flex items-center"
          >
            <Logo />
          </motion.div> 

          <div className="hidden md:flex">
            <DesktopNavigation scrollY={scrollY} />
          </div>

          <motion.div
            style={{ translateX: userMenuTranslateX }}
            className="ml-auto"
          >
              <UserMenu
                isLoggedIn={isLoggedIn}
                isAuthLoading={!!isAuthLoading}
                toggleMenu={toggleMenu}
                isMenuOpen={isMenuOpen}
                userLevel={level}
                userXP={userXP}
                nextLevelXP={nextLevelXP}
              />
          </motion.div>
        </div>
      </motion.header>

      <MobileNavigation
        isMenuOpen={isMenuOpen}
        setIsMenuOpen={setIsMenuOpen}
        isLoggedIn={isLoggedIn}
        isAuthLoading={!!isAuthLoading}
        scrollY={scrollY}
      />
    </>
  );
};

const Logo: React.FC = () => (
  <Link href="/" className="flex items-center w-max">
    <Image
      src={brainwaveSymbol}
      alt="Type Ocean Logo"
      width={30}
      height={30}
      priority
    />
    <h1 className="hidden pl-2 font-semibold text-center shrink-0 sm:flex text-slate-200">
      Type Ocean
    </h1>
  </Link>
);

export default Header;
