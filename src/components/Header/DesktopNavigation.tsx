"use client";
import Link from "next/link";
import {
  motion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { navigation } from "@/constants";
import {
  SPRING_CONFIG,
  SCROLL_RANGE,
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

export default DesktopNavigation