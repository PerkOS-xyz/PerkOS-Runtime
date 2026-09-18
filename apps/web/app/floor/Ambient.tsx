"use client";

import { useEffect, useRef, type ReactNode } from "react";

export default function Ambient({ children, cine = false }: { children: ReactNode; cine?: boolean }) {
  // Sin parallax de raton. La capa inclinaba en 3D lo que envuelve (que en todos los pasos
  // del wizard es la tarjeta, no un logo): el texto se movia al mover el raton y marea.
  // El ambiente lo ponen el blob de marca y las brasas, que no dependen del puntero.
  return (
    <div className={`ambient${cine ? " cine" : ""}`}>
      <div className="letterbox" aria-hidden />
      <div className="brand-blob" aria-hidden />
      <Embers />
      <div className="logo-3d">
        {children}
      </div>
    </div>
  );
}

function Embers() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    let raf = 0;
    const resize = () => {
      W = canvas.width = Math.max(1, Math.floor(canvas.offsetWidth * dpr));
      H = canvas.height = Math.max(1, Math.floor(canvas.offsetHeight * dpr));
    };
    resize();
    window.addEventListener("resize", resize);
    const COLORS = ["236,27,105", "255,90,106", "255,138,92"];
    const ps = Array.from({ length: 48 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.5 + 0.3,
      vx: (Math.random() - 0.5) * 0.00018,
      vy: -(Math.random() * 0.0003 + 0.00008),
      c: COLORS[(Math.random() * COLORS.length) | 0],
      tw: Math.random() * Math.PI * 2,
      tws: Math.random() * 0.03 + 0.01
    }));
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.x += p.vx;
        p.y += p.vy;
        p.tw += p.tws;
        if (p.y < -0.05) {
          p.y = 1.05;
          p.x = Math.random();
        }
        const a = 0.18 + 0.4 * (Math.sin(p.tw) * 0.5 + 0.5);
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, p.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.c},${a})`;
        ctx.shadowColor = `rgba(${p.c},0.75)`;
        ctx.shadowBlur = 7 * dpr;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="embers" aria-hidden />;
}
