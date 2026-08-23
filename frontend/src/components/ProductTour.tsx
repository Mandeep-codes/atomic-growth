import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

// Spotlight coach marks: dark overlay with a hole cut around the target, a
// pulsing ring on the hole, and a tooltip with an arrow pointing at it.
// No dependency — driver.js / shepherd are 30-50kb and would need an install.
// Restart from anywhere with: window.__startTour()

const SEEN_KEY = "atomik-tour-seen-v1";
const PAD = 8;
const GAP = 14;
const CARD_W = 330;

type Step = {
  target?: string[];
  title: string;
  body: string;
  side?: "top" | "bottom";
};

const STEPS: Step[] = [
  {
    title: "Welcome to Atomik Clips",
    body: "You cut clips, post them, and get paid per 1,000 views. This takes about 40 seconds and you can skip it any time.",
  },
  {
    target: ['a[href="/"]'],
    title: "Home",
    body: "Your dashboard. Announcements from the team and from campaigns you've joined land here, along with your view and earnings totals.",
    side: "bottom",
  },
  {
    target: ['a[href="/submissions"]'],
    title: "My Campaigns",
    body: "Every campaign you've joined and every clip you've submitted, with its review status. You join a campaign by submitting your first clip to it.",
    side: "bottom",
  },
  {
    target: ['a[href="/earnings"]'],
    title: "Earnings",
    body: "What you've made, what's cleared, and what's still counting. Views are counted over a rolling 14-day window, so older views drop out over time.",
    side: "bottom",
  },
  {
    target: ['a[href="/demographics-verification"]', '[data-tour="demographics"]'],
    title: "Audience data — worth the two minutes",
    body: "Upload your analytics screenshot here. Some campaigns pay a bonus on top of the base rate when your audience is US-heavy, and it only applies once a moderator approves this.",
    side: "bottom",
  },
  {
    target: ['a[href="/bank-accounts"]'],
    title: "Receive Payments",
    body: "Bank transfer or crypto. You only need this once you actually have a balance to claim, so it's fine to leave until later.",
    side: "bottom",
  },
  {
    target: ['[data-tour="wallet"]'],
    title: "Your balance",
    body: "Always visible up here. It updates as approved clips pick up views.",
    side: "bottom",
  },
  {
    target: ['button[aria-label="Menu"]'],
    title: "Everything else",
    body: "Your connected channels, referrals and profile live in here. Connect a channel before submitting — clips are filed against the account that posted them.",
    side: "bottom",
  },
  {
    title: "That's it",
    body: "Pick a campaign, read its brief, and submit a clip. You can replay this tour any time from the menu.",
  },
];

type Box = { top: number; left: number; width: number; height: number };

const findTarget = (step: Step): HTMLElement | null => {
  if (!step.target) return null;
  for (const selector of step.target) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
};

export const ProductTour = () => {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const cardRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const start = useCallback(() => {
    setIndex(0);
    setOpen(true);
  }, []);

  const finish = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {}
  }, []);

  useEffect(() => {
    // Fires ONCE, and only on the dashboard. A new clipper lands here straight
    // out of onboarding, so this is their first look at the signed-in app - and
    // it must not interrupt someone mid-task on a deeper page.
    if (pathname !== "/") return;
    let seen = "1";
    try {
      seen = window.localStorage.getItem(SEEN_KEY) ?? "";
    } catch {
      seen = "1";
    }
    if (seen) return;
    const t = setTimeout(start, 900);
    return () => clearTimeout(t);
  }, [start, pathname]);

  useEffect(() => {
    (window as any).__startTour = start;
    return () => {
      delete (window as any).__startTour;
    };
  }, [start]);

  const step = STEPS[index];

  useLayoutEffect(() => {
    if (!open || !step) return;
    if (!step.target) {
      setBox(null);
      return;
    }
    const el = findTarget(step);
    if (!el) {
      if (index < STEPS.length - 1) setIndex((i) => i + 1);
      else finish();
      return;
    }
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
      const spaceBelow = window.innerHeight - r.bottom;
      const want = step.side ?? "bottom";
      setSide(want === "bottom" && spaceBelow < 190 ? "top" : want);
    };
    measure();
    const id = setTimeout(measure, reduce ? 0 : 320);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, index, step, reduce, finish]);

  const next = useCallback(() => {
    if (index >= STEPS.length - 1) finish();
    else setIndex((i) => i + 1);
  }, [index, finish]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, back, finish]);

  if (!open || !step) return null;

  const hole = box
    ? { x: box.left - PAD, y: box.top - PAD, w: box.width + PAD * 2, h: box.height + PAD * 2 }
    : null;

  let cardTop = 0;
  let cardLeft = 0;
  if (hole) {
    cardTop = side === "bottom" ? hole.y + hole.h + GAP : hole.y - GAP;
    cardLeft = Math.min(
      Math.max(12, hole.x + hole.w / 2 - CARD_W / 2),
      window.innerWidth - CARD_W - 12
    );
  }
  const arrowLeft = hole
    ? Math.min(Math.max(hole.x + hole.w / 2 - cardLeft, 20), CARD_W - 20)
    : 0;

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-label={`Tour step ${index + 1} of ${STEPS.length}: ${step.title}`}
    >
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <mask id="atomik-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole ? (
              <rect
                x={hole.x} y={hole.y} width={hole.w} height={hole.h}
                rx={Math.min(14, hole.h / 2)} fill="black"
                style={{ transition: reduce ? "none" : "all .34s cubic-bezier(.2,.8,.2,1)" }}
              />
            ) : null}
          </mask>
        </defs>
        <rect
          width="100%" height="100%" fill="rgba(0,0,0,0.74)"
          mask="url(#atomik-tour-mask)" onClick={finish}
        />
        {hole ? (
          <rect
            x={hole.x} y={hole.y} width={hole.w} height={hole.h}
            rx={Math.min(14, hole.h / 2)} fill="none" stroke="white" strokeWidth="2"
            style={{
              transition: reduce ? "none" : "all .34s cubic-bezier(.2,.8,.2,1)",
              animation: reduce ? undefined : "atomik-tour-pulse 2s infinite",
            }}
          />
        ) : null}
      </svg>

      <style>{`
        @keyframes atomik-tour-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes atomik-tour-in { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
      `}</style>

      <div
        ref={cardRef}
        style={{
          width: CARD_W,
          ...(hole
            ? { position: "absolute" as const, top: cardTop, left: cardLeft,
                transform: side === "top" ? "translateY(-100%)" : undefined }
            : { position: "absolute" as const, top: "50%", left: "50%",
                transform: "translate(-50%,-50%)" }),
          animation: reduce ? undefined : "atomik-tour-in .26s ease-out",
        }}
        className="rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        {hole ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: arrowLeft - 6,
              ...(side === "bottom" ? { top: -7 } : { bottom: -7 }),
            }}
            className={
              "h-3 w-3 rotate-45 border-border bg-card " +
              (side === "bottom" ? "border-l border-t" : "border-b border-r")
            }
          />
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {index + 1} of {STEPS.length}
          </span>
          <button
            type="button" onClick={finish}
            className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Skip tour
          </button>
        </div>

        <h3 className="mt-3 text-lg font-semibold leading-tight">{step.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={
                  "h-1 rounded-full transition-all " +
                  (i === index ? "w-4 bg-foreground"
                    : i < index ? "w-1 bg-foreground/50" : "w-1 bg-border")
                }
              />
            ))}
          </div>
          {index > 0 ? (
            <button
              type="button" onClick={back}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Back
            </button>
          ) : null}
          <button
            type="button" onClick={next}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-transform hover:scale-[0.98]"
          >
            {index === STEPS.length - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductTour;
