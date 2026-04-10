"use client";

import { useEffect, useRef } from "react";

export function CinematicBackground({ intensity = "medium" }: { intensity?: "low" | "medium" | "high" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let particles: Array<{
      x: number;
      y: number;
      radius: number;
      alpha: number;
      speedX: number;
      speedY: number;
    }> = [];

    const particleCount = intensity === "low" ? 50 : intensity === "medium" ? 100 : 150;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      initParticles();
    };

    const initParticles = () => {
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 1.5 + 0.5,
          alpha: Math.random() * 0.5 + 0.1,
          speedX: (Math.random() - 0.5) * 0.2,
          speedY: (Math.random() - 0.5) * 0.2,
        });
      }
    };

    let animationFrame: number;
    const draw = () => {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      // Gradient sky
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#0A0F1A");
      gradient.addColorStop(0.5, "#0C1022");
      gradient.addColorStop(1, "#080C18");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Particles
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100, 180, 255, ${p.alpha * 0.6})`;
        ctx.fill();

        p.x += p.speedX;
        p.y += p.speedY;
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;
      }

      animationFrame = requestAnimationFrame(draw);
    };

    window.addEventListener("resize", resize);
    resize();
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrame);
    };
  }, [intensity]);

  return (
    <>
      <canvas ref={canvasRef} className="fixed inset-0 -z-20" />
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5" />
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-transparent via-transparent to-black/50" />
    </>
  );
}