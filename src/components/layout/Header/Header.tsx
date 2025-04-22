"use client";
import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useMotionTemplate,
} from "framer-motion";
import {
  UserMenu,
  MobileNavigation,
  DesktopNavigation,
} from "@/components/layout/Header";
import { brainwaveSymbol } from "@/assets";
import { SPRING_CONFIG, SCROLL_RANGE } from "@/constants/constants";
import { useLevel } from "@/hooks/useLevel";

const Header: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();

  const createAnimatedValue = (outputRange: [any, any]) =>
    useSpring(useTransform(scrollY, SCROLL_RANGE, outputRange), SPRING_CONFIG);

  const headerWidth = createAnimatedValue(["100%", "75%"]);
  const headerBorderRadius = createAnimatedValue([0, 9999]);
  const headerOpacity = createAnimatedValue([1, 0.95]);
  const backdropBlur = createAnimatedValue([0, 2]);
  const borderOpacity = createAnimatedValue([0, 0.3]);
  const logoTranslateX = createAnimatedValue([0, 10]);
  const userMenuTranslateX = createAnimatedValue([0, -5]);
  const backgroundAlpha = createAnimatedValue([0, 0.05]);

  const toggleMenu = useCallback(() => setIsMenuOpen((prev) => !prev), []);

  const backdropFilterValue = useMotionTemplate`blur(${backdropBlur}px)`;
  const borderValue = useMotionTemplate`1px solid rgba(148, 163, 184, ${borderOpacity})`;
  const backgroundColorValue = useMotionTemplate`rgba(255, 255, 255, ${backgroundAlpha})`;

  const { level, userXP, nextLevelXP } = useLevel();

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
