"use client";
import Link from "next/link";
import {
  motion,
  useSpring,
  useTransform,
  AnimatePresence,
  type MotionValue,
} from "framer-motion";
import { navigation } from "@/constants";
import {
  SPRING_CONFIG,
  SCROLL_RANGE,
  MOBILE_MENU_TRANSITION,
} from "@/constants/constants";

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
          <div className="flex items-center justify-center w-full h-full mt-2">
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
                  className="block px-6 py-5 text-xl text-white uppercase transition-colors hover:text-slate-200"
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
  

export default MobileNavigation;