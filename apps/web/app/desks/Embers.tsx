"use client";

import { useEffect, useRef } from "react";

const COLORS = ["236,27,105", "255,90,106", "255,138,92"];

/** Slow embers rising behind the scene. Nothing moves when the person asks for less motion. */
export function Embers() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let frame = 0;
    const resize = () => {
      w = canvas.width = Math.max(1, Math.floor(canvas.offsetWidth * dpr));
      h = canvas.height = Math.max(1, Math.floor(canvas.offsetHeight * dpr));
    };
    resize();
    window.addEventListener("resize", resize);
    const dots = Array.from({ length: 46 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.5 + 0.3,
      vx: (Math.random() - 0.5) * 0.00018,
      vy: -(Math.random() * 0.0003 + 0.00008),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.03 + 0.01
    }));
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        d.phase += d.speed;
        if (d.y < -0.05) {
          d.y = 1.05;
          d.x = Math.random();
        }
        const alpha = 0.18 + 0.4 * (Math.sin(d.phase) * 0.5 + 0.5);
        ctx.beginPath();
        ctx.arc(d.x * w, d.y * h, d.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${d.color},${alpha})`;
        ctx.shadowColor = `rgba(${d.color},0.75)`;
        ctx.shadowBlur = 7 * dpr;
        ctx.fill();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="st-embers" aria-hidden />;
}
