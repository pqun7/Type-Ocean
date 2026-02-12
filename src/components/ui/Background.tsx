import React, { type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export default function Background({ className, style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return React.createElement(
    "div",
    {
      ...props,
      "aria-hidden": true,
      className: cn("fixed inset-0 z-[-1] overflow-hidden bg-[#0a0a1f]", className),
      style: { pointerEvents: "none", ...(style ?? {}) },
    },
    React.createElement("div", {
      className: "absolute inset-0 bg-gradient-to-br from-[#1B1B2E] via-[#1D2B3A] to-[#0E1117]",
    }),
    React.createElement("div", {
      className:
        "absolute bottom-0 left-1/4 h-96 w-[60px] rounded-full bg-gradient-to-r from-[#69d0ff55] to-[#8A6BFF55] blur-[100px] opacity-[0.55] animate-bubble",
    }),
    React.createElement("div", { className: "absolute inset-0 bg-grid opacity-15" }),
    React.createElement("div", {
      className:
        "absolute -top-20 -left-40 h-[800px] w-[800px] rounded-full bg-gradient-to-r from-[#69d0ff20] to-[#8A6BFF20] blur-[150px] animate-pulse-slow",
    }),
    React.createElement("div", {
      className:
        "absolute -top-40 -right-60 h-[700px] w-[700px] rotate-45 rounded-full bg-gradient-to-l from-[#69d0ff22] to-[#8A6BFF22] blur-[120px]",
    }),
    React.createElement("div", {
      className:
        "absolute inset-0 bg-[radial-gradient(circle,#69d0ff22_1px,transparent_1px)] bg-[size:20px_20px] opacity-10",
    })
  );
}
// Background.tsx
// "use client";

// import React, { Suspense, useMemo } from "react";
// import { Canvas } from "@react-three/fiber";
// import { Environment, Preload } from "@react-three/drei";
// import { HTMLAttributes } from "react";
// import WhaleModel from "@/assets/3d/WhaleModel";
// import * as THREE from "three";

// const Background = ({ className }: HTMLAttributes<HTMLDivElement>) => {
//   // Memoize color objects for performance
//   const colors = useMemo(() => ({
//     primary: new THREE.Color("#69d0ff"),
//     secondary: new THREE.Color("#8A6BFF"),
//     dark: new THREE.Color("#0a0a1f"),
//     gradientStart: new THREE.Color("#1B1B2E"),
//     gradientMid: new THREE.Color("#1D2B3A"),
//     gradientEnd: new THREE.Color("#0E1117")
//   }), []);

//   return (
//     <div
//       className={`fixed inset-0 z-[-1] overflow-hidden bg-[#0a0a1f] ${className || ""}`}
//       style={{ pointerEvents: "none" }}
//     >
//       {/* Base gradient layer */}
//       <div 
//         className="absolute inset-0" 
//         style={{
//           background: `linear-gradient(135deg, ${colors.gradientStart.getStyle()} 0%, ${colors.gradientMid.getStyle()} 50%, ${colors.gradientEnd.getStyle()} 100%)`
//         }}
//       />

//       {/* 3D Canvas - Performance Optimized */}
//       <Canvas
//         className="absolute inset-0"
//         style={{ pointerEvents: "none" }}
//         dpr={[1, 2]} // Adaptive pixel ratio
//         frameloop="always" // Continuous smooth animation
//         performance={{ min: 0.5 }} // Maintain at least 50% performance
//         gl={{
//           antialias: true,
//           alpha: false,
//           powerPreference: "high-performance",
//           outputColorSpace: THREE.SRGBColorSpace, // Correct color space for modern browsers
//           toneMapping: THREE.ACESFilmicToneMapping,
//           toneMappingExposure: 0.8,
//         }}
//         camera={{
//           position: [0, 0, 18],
//           fov: 55,
//           near: 0.1,
//           far: 100,
//           zoom: 1
//         }}
//         shadows={false} // Disable all shadows for performance
//         linear={false} // Keep for color accuracy with sRGB
//       >
//         {/* Color management */}
//         <color attach="background" args={["#0a0a1f"]} />
        
//         {/* Optimized lighting setup */}
//         <ambientLight 
//           intensity={0.35} 
//           color={colors.primary} 
//         />
//         <directionalLight
//           position={[12, 12, 8]}
//           intensity={0.65}
//           color={colors.secondary}
//           castShadow={false}
//         />
//         <directionalLight
//           position={[-12, -8, -8]}
//           intensity={0.25}
//           color={colors.dark}
//           castShadow={false}
//         />
        
//         {/* Subtle fill light for depth */}
//         <hemisphereLight
//           intensity={0.15}
//           groundColor={colors.dark}
//           color={colors.primary}
//         />

//         <Suspense 
//           fallback={null} // No loading state for background element
//         >
//           <WhaleModel />
          
//           {/* Minimal environment for reflections */}
//           <Environment
//             preset="city"
//             background={false}
//             blur={0.4}
//             environmentIntensity={0.3}
//             resolution={256} // Lower resolution for performance
//           />
          
//           {/* Preload all assets */}
//           <Preload all />
//         </Suspense>
//       </Canvas>

//       {/* CSS Effects - Layered over 3D for performance */}
//       <div className="absolute bottom-0 left-1/4 w-15 h-96 bg-gradient-to-r from-[#69d0ff55] to-[#8A6BFF55] rounded-full blur-[100px] animate-bubble opacity-40" />
//       <div className="absolute inset-0 bg-grid opacity-10" />
      
//       {/* Animated light effects */}
//       <div className="absolute -top-20 -left-40 w-[800px] h-[800px] bg-gradient-to-r from-[#69d0ff15] to-[#8A6BFF15] rounded-full blur-[150px] animate-pulse-slow" />
//       <div className="absolute -top-40 -right-60 w-[700px] h-[700px] bg-gradient-to-l from-[#69d0ff18] to-[#8A6BFF18] rounded-full blur-[120px] rotate-45" />
      
//       {/* Subtle water ripple effects */}
//       <div 
//         className="absolute inset-0 opacity-5"
//         style={{
//           backgroundImage: `radial-gradient(circle at 30% 30%, ${colors.primary.getStyle()}22 1px, transparent 1px)`,
//           backgroundSize: '30px 30px',
//           animation: 'ripple 20s infinite linear'
//         }}
//       />
      
//       {/* Subtle noise texture for depth */}
//       <div className="absolute inset-0 opacity-2 noise-texture" />
      
//       <style jsx>{`
//         @keyframes bubble {
//           0%, 100% { transform: translateY(0) scale(1); opacity: 0.4; }
//           50% { transform: translateY(-20px) scale(1.1); opacity: 0.6; }
//         }
//         @keyframes pulse-slow {
//           0%, 100% { opacity: 0.15; }
//           50% { opacity: 0.25; }
//         }
//         @keyframes ripple {
//           0% { background-position: 0 0; }
//           100% { background-position: 30px 30px; }
//         }
//         .animate-bubble {
//           animation: bubble 8s ease-in-out infinite;
//         }
//         .animate-pulse-slow {
//           animation: pulse-slow 12s ease-in-out infinite;
//         }
//         .noise-texture {
//           background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.02'/%3E%3C/svg%3E");
//         }
//         .bg-grid {
//           background-image: linear-gradient(to right, #69d0ff11 1px, transparent 1px),
//                             linear-gradient(to bottom, #69d0ff11 1px, transparent 1px);
//           background-size: 50px 50px;
//         }
//       `}</style>
//     </div>
//   );
// };

// export default Background;