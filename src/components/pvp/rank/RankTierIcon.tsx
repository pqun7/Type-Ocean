"use client";

import React from "react";
import Image from "next/image";

interface RankTierIconProps {
  src: string;
  alt: string;
  size: number;
  color?: string;
  className?: string;
}

export function RankTierIcon({
  src,
  alt,
  size,
  color,
  className = "",
}: RankTierIconProps) {
  const wrapperStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    maxWidth: size,
    maxHeight: size,
    flex: "0 0 auto",
    lineHeight: 0,
  };

  if (color) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={className}
        style={wrapperStyle}
      >
        <span
          aria-hidden="true"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            backgroundColor: color,
            WebkitMaskImage: `url(${src})`,
            maskImage: `url(${src})`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      </span>
    );
  }

  return (
    <span className={className} style={wrapperStyle}>
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        unoptimized
        priority
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    </span>
  );
}
