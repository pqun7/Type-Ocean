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
    <motion.nav 
      style={{ opacity: navOpacity }}
      className="hidden sm:flex flex-1 justify-end items-center"
    >
      <div className="flex space-x-2 mx-4">
        {filteredNavigation.map((item) => (
          <motion.div 
            key={item.id} 
            whileHover={{ scale: 1.05 }}
            className="relative"
          >
            <Link
              href={item.url}
              className="text-sm font-medium text-slate-300 hover:text-white transition-all duration-300 px-3 py-1 rounded-lg hover:bg-white/5"
            >
              {item.title}
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.nav>
  );
};

export default DesktopNavigation;