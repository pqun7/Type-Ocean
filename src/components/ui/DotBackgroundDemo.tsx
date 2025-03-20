import React from "react";

export function DotBackgroundDemo({className}: {className?: string}) {
  return (
    <div className="bg-dot-white relative flex items-center justify-center" />
      );
}

//absolute pointer-events-none inset-0 flex items-center justify-center bg-black [mask-image:radial-gradient(ellipse_at_center,transparent_20%,white)]