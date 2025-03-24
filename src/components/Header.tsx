"use client";
import { useState, useRef, useEffect } from "react";
import { FiUser } from "react-icons/fi";
import { HiOutlineMenu, HiX } from "react-icons/hi";
import Image from "next/image";
import { brainwaveSymbol } from "@/assets";
import { navigation } from "@/constants";
import { HoverBorderGradient } from "@/components/ui/hover-border-gradient";

import Link from "next/link";
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  AnimatePresence,
  useMotionTemplate,
  MotionValue,
} from "framer-motion";

const Header: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(true);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const headerRef = useRef<HTMLDivElement>(null);

  const { scrollY } = useScroll();
  const springConfig = { stiffness: 200, damping: 25, mass: 0.5 };

  const headerWidth = useSpring(
    useTransform(scrollY, [0, 100], ["100%", "70%"]),
    springConfig
  );

  const headerBorderRadius = useSpring(
    useTransform(scrollY, [0, 100], [0, 9999]),
    springConfig
  );

  const headerOpacity = useSpring(
    useTransform(scrollY, [0, 80], [1, 0.95]),
    springConfig
  );

  const backdropBlur = useSpring(
    useTransform(scrollY, [0, 50, 100], [0, 2, 4]),
    springConfig
  );

  const borderOpacity = useSpring(
    useTransform(scrollY, [0, 100], [0, 0.3]),
    springConfig
  );

  const logoTranslateX = useSpring(
    useTransform(scrollY, [0, 100], [0, 10]),
    springConfig
  );

  const userMenuTranslateX = useSpring(
    useTransform(scrollY, [0, 100], [0, -5]),
    springConfig
  );

  const backgroundAlpha = useSpring(
    useTransform(scrollY, [0, 100], [0, 0.1]),
    springConfig
  );

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem("userToken"));
  }, []);

  const toggleMenu = () => setIsMenuOpen((prev) => !prev);
  const backdropFilterValue = useMotionTemplate`blur(${backdropBlur}px)`;
  const borderValue = useMotionTemplate`1px solid rgba(148, 163, 184, ${borderOpacity})`;
  const backgroundColorValue = useMotionTemplate`rgba(255, 255, 255, ${backgroundAlpha})`;
  return (
    <>
      <motion.header
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
        className="fixed top-0 left-0 right-0 z-50 mx-auto h-16 mt-2 border border-slate-300 "
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
      alt="brainwave"
      width={30}
      height={30}
      priority
    />
    <h1 className="hidden pl-2 font-semibold text-center shrink-0 md:flex">
      Type Ocean
    </h1>
  </Link>
);

interface NavigationProps {
  scrollY: MotionValue<number>;
}

const DesktopNavigation: React.FC<NavigationProps> = ({ scrollY }) => {
  const navOpacity = useSpring(useTransform(scrollY, [0, 100], [1, 0.95]), {
    stiffness: 200,
    damping: 25,
    mass: 0.5,
  });

  return (
    <motion.nav
      style={{
        opacity: navOpacity,
      }}
      className="hidden pl-6 space-x-6 sm:flex md:items-center sm:w-full md:px-10 xl:px-32 justify-center"
    >
      {navigation.map(
        (item) =>
          !item.onlyMobile && (
            <motion.div key={item.id}>
              <Link
                href={item.url}
                className="mr-2 font-semibold uppercase transition-colors text-md text-slate-200 font-code hover:text-white"
              >
                {item.title}
              </Link>
            </motion.div>
          )
      )}
    </motion.nav>
  );
};

interface UserMenuProps {
  isLoggedIn: boolean;
  toggleMenu: () => void;
  isMenuOpen: boolean;
}

const UserMenu: React.FC<UserMenuProps> = ({
  isLoggedIn,
  toggleMenu,
  isMenuOpen,
}) => (
  <div className="flex items-center ml-auto space-x-4">
    {isLoggedIn ? (
      <Link href="/user" className="relative flex items-center justify-center">
        <FiUser
          size={28}
          className="text-slate-100 hover:text-slate-300 transition-colors"
        />
      </Link>
    ) : (
      <HoverBorderGradient
        containerClassName="rounded-full hidden sm:block"
        as="button"
        className="bg-transparent text-slate-300 hover:text-slate-100 "
        bgColor="bg-[rgba(255, 255, 255, 0.1)]"
        hideMovingBorder={true}
      >
        <Link href="/login" className="px-4 py-2 font-jetbrains">
          Login
        </Link>
      </HoverBorderGradient>
    )}
    {isMenuOpen ? (
      <HiX
        className="text-2xl cursor-pointer text-slate-200 hover:text-white sm:hidden"
        onClick={toggleMenu}
      />
    ) : (
      <HiOutlineMenu
        className="text-2xl cursor-pointer text-slate-200 hover:text-white sm:hidden"
        onClick={toggleMenu}
      />
    )}
  </div>
);

interface MobileNavigationProps {
  isMenuOpen: boolean;
  setIsMenuOpen: (open: boolean) => void;
  isLoggedIn: boolean;
  scrollY: MotionValue<number>;
}

const MobileNavigation: React.FC<MobileNavigationProps> = ({
  isMenuOpen,
  setIsMenuOpen,
  scrollY,
  isLoggedIn
}) => {
  const marginAdjust = useSpring(useTransform(scrollY, [0, 100], [0, -40]), {
    stiffness: 200,
    damping: 25,
    mass: 0.5,
  });

  return (
    <>
      <motion.div
        className="fixed top-0 right-0 h-screen w-full sm:hidden z-30"
        initial={{ x: "100%" }}
        animate={{ x: isMenuOpen ? 0 : "100%" }}
        style={{
          marginLeft: marginAdjust,
          marginTop: marginAdjust,
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <div className="flex items-center justify-center w-full h-full">
          <motion.nav
            initial={{ opacity: 0 }}
            animate={{ opacity: isMenuOpen ? 1 : 0 }}
            transition={{ duration: 0.3 }}
            className="z-30 flex flex-col items-center justify-center lg:flex-row"
          >
            {navigation
              .filter((item) => !(isLoggedIn && item.isLoggedIn === false)) // 🚀 تصفية العناصر
              .map((item) => (
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
      {/* backgrouud overlay */}

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0, filter: "blur(0px)" }}
            animate={{
              opacity: 0.7,
              filter: "blur(24px)",
            }}
            exit={{ opacity: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="h-screen w-screen sm:hidden fixed inset-0 bg-black bg-opacity-70 z-20"
            onClick={() => setIsMenuOpen(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default Header;
