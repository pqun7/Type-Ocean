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
  DesktopNavigation,
  MobileNavigation,
  UserMenu,
} from "@/components/Navigation";
import { brainwaveSymbol } from "@/assets";
import {SPRING_CONFIG, SCROLL_RANGE} from "@/constants/constants";

const Header: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();

  const createAnimatedValue = (outputRange: [any, any]) =>
    useSpring(useTransform(scrollY, SCROLL_RANGE, outputRange), SPRING_CONFIG);

  const headerWidth = createAnimatedValue(["100%", "70%"]);
  const headerBorderRadius = createAnimatedValue([0, 9999]);
  const headerOpacity = createAnimatedValue([1, 0.95]);
  const backdropBlur = createAnimatedValue([0, 4]);
  const borderOpacity = createAnimatedValue([0, 0.3]);
  const logoTranslateX = createAnimatedValue([0, 10]);
  const userMenuTranslateX = createAnimatedValue([0, -5]);
  const backgroundAlpha = createAnimatedValue([0, 0.1]);

  const toggleMenu = useCallback(() => setIsMenuOpen((prev) => !prev), []);

  const backdropFilterValue = useMotionTemplate`blur(${backdropBlur}px)`;
  const borderValue = useMotionTemplate`1px solid rgba(148, 163, 184, ${borderOpacity})`;
  const backgroundColorValue = useMotionTemplate`rgba(255, 255, 255, ${backgroundAlpha})`;

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
        <div className="flex items-center justify-between h-full px-2 lg:px-16">
          <motion.div style={{ translateX: logoTranslateX }} className="z-10">
            <Logo />
          </motion.div>

          <DesktopNavigation scrollY={scrollY} />

          <motion.div style={{ translateX: userMenuTranslateX }}>
            <UserMenu
              isLoggedIn={isLoggedIn}
              toggleMenu={toggleMenu}
              isMenuOpen={isMenuOpen}
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
  <Link href="/" className="flex items-center">
    <Image
      src={brainwaveSymbol}
      alt="Type Ocean Logo"
      width={30}
      height={30}
      priority
    />
    <h1 className="hidden pl-2 font-semibold text-center shrink-0 md:flex">
      Type Ocean
    </h1>
  </Link>
);

export default Header;
