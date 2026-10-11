"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const ENTER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "none" },
];

/**
 * The main scroll column. On every route change it plays a short fade/rise
 * via the Web Animations API — no remount and no wrapper element, so page
 * state and layouts that rely on `height: 100%` are untouched.
 */
export default function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = 0;
    if (firstRender.current) { firstRender.current = false; return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(ENTER_KEYFRAMES, { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }, [pathname]);

  return (
    <main ref={ref} className="main-content" id="main-content">
      {children}
    </main>
  );
}
