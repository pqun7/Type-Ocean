'use client';

import { motion } from "framer-motion";
import { PvpSocketProvider } from "@/features/pvp/client/usePvpSocket";

export default function PvpLayout({ children }: { children: React.ReactNode }) {
  return (
    <PvpSocketProvider>
      <div className="relative min-h-screen">
        {/* Ambient Dynamic Background */}
        <div className="fixed inset-0 -z-10" aria-hidden="true">
          <div className="absolute inset-0 bg-gradient-to-br from-[#050814] via-[#0a0f1a] to-[#030614]" />
          <motion.div
            className="absolute top-1/4 left-1/4 h-[600px] w-[600px] rounded-full bg-blue-600/10 blur-[140px]"
            animate={{ x: [0, 30, -20, 0], y: [0, -20, 30, 0] }}
            transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute bottom-1/4 right-1/4 h-[500px] w-[500px] rounded-full bg-purple-600/10 blur-[140px]"
            animate={{ x: [0, -30, 20, 0], y: [0, 20, -30, 0] }}
            transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2280%22%20height%3D%2280%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22grid%22%20width%3D%2280%22%20height%3D%2280%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Cpath%20d%3D%22M%2080%200%20L%200%200%200%2080%22%20fill%3D%22none%22%20stroke%3D%22rgba%28255%2C255%2C255%2C0.02%29%22%20stroke-width%3D%221%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url%28%23grid%29%22/%3E%3C/svg%3E')] opacity-20" />
        </div>
        <div className="relative z-10">{children}</div>
      </div>
    </PvpSocketProvider>
  );
}



function BackgroundEffects() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* Deep gradient base */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0A0F1A] via-[#0A0F1A] to-[#0A0C14]" />

      {/* Animated volumetric lights */}
      <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-blue-500/5 blur-[120px] animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full bg-purple-500/5 blur-[120px] animate-pulse delay-1000" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-cyan-500/5 blur-[150px] animate-pulse-slow" />

      {/* Particle grid (enhanced) */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22grid%22%20width%3D%2260%22%20height%3D%2260%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Cpath%20d%3D%22M%2060%200%20L%200%200%200%2060%22%20fill%3D%22none%22%20stroke%3D%22rgba%28255%2C255%2C255%2C0.02%29%22%20stroke-width%3D%221%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url%28%23grid%29%22/%3E%3C/svg%3E')] opacity-20" />

      {/* Animated floating particles (pseudo-elements via tailwind not easy, but we can add a div) */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/10 blur-sm animate-float"
            style={{
              width: Math.random() * 4 + 2,
              height: Math.random() * 4 + 2,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 10}s`,
              animationDuration: `${Math.random() * 15 + 10}s`,
            }}
          />
        ))}
      </div>

      <style jsx>{`
        @keyframes float {
          0% { transform: translateY(0px) translateX(0px); opacity: 0; }
          10% { opacity: 0.5; }
          90% { opacity: 0.5; }
          100% { transform: translateY(-100px) translateX(30px); opacity: 0; }
        }
        .animate-float {
          animation: float linear infinite;
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}