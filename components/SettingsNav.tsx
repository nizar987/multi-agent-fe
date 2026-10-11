"use client";
import { useEffect, useRef, useState } from "react";

interface Section {
  id: string;
  label: string;
}

/** A section counts as "current" once its top passes this far below the scroller's top. */
const ACTIVATION_OFFSET = 120;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Sticky in-page navigation for long settings pages. Highlights the section
 * currently being read (scroll-spy) and scrolls smoothly on click.
 */
export default function SettingsNav({ sections }: { sections: Section[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  const navRef = useRef<HTMLElement>(null);
  // Section the user just clicked. Short trailing sections can never reach the
  // top of the scroller, so near the bottom we trust the click over geometry.
  const clickedRef = useRef<string | null>(null);

  useEffect(() => {
    const scroller = scrollParent(navRef.current);
    if (!scroller) return;

    const update = () => {
      const top = scroller.getBoundingClientRect().top;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      let current = sections[0]?.id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top - top <= ACTIVATION_OFFSET) current = s.id;
      }
      if (atBottom) current = clickedRef.current ?? sections[sections.length - 1]?.id;
      setActive(current);
    };

    // any manual scroll gesture hands control back to the geometry
    const forgetClick = () => { clickedRef.current = null; };

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    scroller.addEventListener("wheel", forgetClick, { passive: true });
    scroller.addEventListener("touchmove", forgetClick, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller.removeEventListener("scroll", update);
      scroller.removeEventListener("wheel", forgetClick);
      scroller.removeEventListener("touchmove", forgetClick);
      window.removeEventListener("resize", update);
    };
  }, [sections]);

  const go = (id: string) => {
    clickedRef.current = id;
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav ref={navRef} className="settings-nav" aria-label="Settings sections">
      {sections.map((s) => (
        <button
          key={s.id}
          className={`settings-nav-item${active === s.id ? " active" : ""}`}
          aria-current={active === s.id ? "true" : undefined}
          onClick={() => go(s.id)}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
