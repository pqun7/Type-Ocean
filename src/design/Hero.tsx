"use client";
import { useEffect, useState, RefObject } from "react";
import { MouseParallax } from "react-just-parallax";
import PlusSvg from "@/assets/svg/PlusSvg";

type BackgroundCirclesProps = {
  parallaxRef: RefObject<HTMLDivElement | null>;
};

export const Gradient = () => {
  return (
    <>
      <div className="relative z-1 h-6 mx-2.5 bg-n-11 shadow-xl rounded-b-[1.25rem] lg:h-6 lg:mx-8" />
      <div className="relative z-1 h-6 mx-6 bg-n-11/70 shadow-xl rounded-b-[1.25rem] lg:h-6 lg:mx-20" />
    </>
  );
};

export const BottomLine = () => {
  return (
    <>
      <div className="hidden absolute top-[55.25rem] left-10 right-10 h-0.25 bg-n-6 pointer-events-none xl:block" />
      <PlusSvg className="hidden absolute top-[54.9375rem] left-[2.1875rem] z-2 pointer-events-none xl:block" />
      <PlusSvg className="hidden absolute top-[54.9375rem] right-[2.1875rem] z-2 pointer-events-none xl:block" />
    </>
  );
};

const Rings = () => {
  return (
    <>
      <div className="absolute top-1/2 left-1/2 w-[65.875rem] aspect-square border border-n-2/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute top-1/2 left-1/2 w-[51.375rem] aspect-square border border-n-2/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute top-1/2 left-1/2 w-[36.125rem] aspect-square border border-n-2/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute top-1/2 left-1/2 w-[23.125rem] aspect-square border border-n-2/10 rounded-full -translate-x-1/2 -translate-y-1/2" />
    </>
  );
};

export const BackgroundCircles = ({ parallaxRef }: BackgroundCirclesProps) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="absolute -top-[42.375rem] left-1/2 w-[78rem] aspect-square border border-n-2/5 rounded-full -translate-x-1/2 md:-top-[38.5rem] xl:-top-[32rem]">
      <MouseParallax strength={0.07} parallaxContainerRef={parallaxRef}>
        <Rings />

        {[46, -56, 54, -65, -85, 70].map((rotation, index) => {
          const size = [2, 4, 4, 3, 6, 6][index];
          const marginTop = [36, 32, -12.9, -52, 3, 3][index];
          const colors = [
            "from-[#DD734F] to-[#1A1A32]",
            "from-[#DD734F] to-[#1A1A32]",
            "from-[#B9AEDF] to-[#1A1A32]",
            "from-[#B9AEDF] to-[#1A1A32]",
            "from-[#88E5BE] to-[#1A1A32]",
            "from-[#88E5BE] to-[#1A1A32]",
          ];
          return (
            <div
              key={index}
              className={`absolute bottom-1/2 left-1/2 w-0.25 h-1/2 origin-bottom rotate-[${rotation}deg]`}
            >
              <div
                className={`w-${size} h-${size} -ml-1 -mt-${marginTop} bg-gradient-to-b ${colors[index]} rounded-full transition-transform duration-500 ease-out ${mounted ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"}`}
              />
            </div>
          );
        })}
      </MouseParallax>
    </div>
  );
};