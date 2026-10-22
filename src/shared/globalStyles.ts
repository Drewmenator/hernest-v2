// ─── Global styles ─────────────────────────────────────────────────
// Injected once by App (and the design preview).
import { T, MOTION, GRAIN } from "../config/theme";

export const globalStyles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  
  /* Mobile-first base */
  html {
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
    height: 100%;
    /* Safe area support for iPhone notch/home indicator */
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  
  body {
    background: ${T.cream};
    font-family: 'DM Sans', sans-serif;
    overflow-x: hidden;
    overflow-y: auto;
    min-height: 100%;
    min-height: -webkit-fill-available;
    /* Smooth momentum scrolling on iOS */
    -webkit-overflow-scrolling: touch;
  }
  
  /* Warm paper: soft light on the ivory page plus a very fine grain.
     Two fixed layers behind everything, painted once (they never move
     while scrolling). html.hn-flat turns them off for comparison. */
  body::before, body::after {
    content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  }
  body::before {
    background:
      radial-gradient(80% 50% at 100% 0%, rgba(207,190,230,.7) 0%, rgba(214,201,232,0) 72%),
      radial-gradient(50% 30% at 15% 8%, rgba(255,255,255,.7) 0%, rgba(255,255,255,0) 70%),
      radial-gradient(60% 40% at 0% 100%, rgba(245,222,213,.45) 0%, rgba(245,222,213,0) 70%),
      linear-gradient(180deg, #F6F1E6 0%, ${T.cream} 45%, #F1EADB 100%);
  }
  body::after { background-image: ${GRAIN}; background-size: 160px 160px; opacity: .07; }
  html.hn-flat body::before, html.hn-flat body::after { display: none; }

  /* Fine grain inside a card (Cleo's hero only), kept under the text. */
  .hn-grain { isolation: isolate; }
  .hn-grain::after {
    content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit;
    background-image: ${GRAIN}; background-size: 160px 160px; opacity: .08;
  }
  html.hn-flat .hn-grain::after { display: none; }

  /* Remove tap highlights on mobile */
  * { -webkit-tap-highlight-color: transparent; }

  /* Keyboard focus must be visible — tap-highlight removal killed every
     focus cue. :focus-visible only fires for keyboard/AT, so touch is
     unaffected. */
  :focus-visible {
    outline: 2px solid ${T.gold} !important;
    outline-offset: 2px;
    border-radius: 4px;
  }

  /* Respect vestibular/motion preferences */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  
  /* Buttons — minimum 44px touch target per Apple HIG */
  button {
    cursor: pointer;
    touch-action: manipulation;
  }
  
  /* Inputs */
  input, textarea, select {
    font-family: 'DM Sans', sans-serif;
    /* Prevent zoom on focus in iOS */
    font-size: max(16px, 1em);
  }
  
  /* Scrollable containers */
  .scroll-x {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .scroll-x::-webkit-scrollbar { display: none; }

  /* Loading placeholders (Skeleton): a soft light sweeps across. The
     sweep is a transform, so it stays smooth while the page scrolls. */
  .hn-skeleton { position: relative; overflow: hidden; background: #ECE5D6; }
  .hn-skeleton::after {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.55) 50%, rgba(255,255,255,0) 100%);
    transform: translateX(-100%);
    animation: hnShimmer 1.5s ease-in-out infinite;
  }
  .hn-skeleton.on-tint { background: rgba(255,255,255,.45); }
  @keyframes hnShimmer { to { transform: translateX(100%) } }

  /* Cards below the fold ease in as they scroll into view (Reveal). */
  .hn-reveal { opacity: 0; transform: translate3d(0,18px,0) scale(.985); }
  .hn-reveal.is-in {
    opacity: 1; transform: none;
    transition: opacity .5s ease, transform .65s ${MOTION.ease};
  }

  /* Small charts: bars rise, lines fade in. */
  .hn-grow { transform-origin: 50% 100%; animation: hnGrow .7s ${MOTION.ease} both; }
  @keyframes hnGrow { from { transform: scaleY(0) } to { transform: scaleY(1) } }
  .hn-fade { animation: hnFade .8s ease both; }
  @keyframes hnFade { from { opacity: 0 } to { opacity: 1 } }

  /* Pull to refresh: Cleo's sparkle turns while Today reloads. */
  @keyframes hnSpinSoft { to { transform: rotate(360deg) } }

  /* Cards you can tap sink a little under your finger. */
  .hn-press { transition: transform .18s ${MOTION.ease}; }
  .hn-press:active { transform: scale(.985); }

  @media (prefers-reduced-motion: reduce) {
    .hn-reveal { opacity: 1; transform: none; }
    .hn-skeleton::after { animation: none; transform: none; opacity: .4; }
  }

  /* Press feedback on buttons, instant on touch-down */
  button:active:not(:disabled) { transform: scale(0.98); }

  /* Animations */
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
  @keyframes spin { to { transform:rotate(360deg) } }
  @keyframes breathe { 0%,100% { transform:scale(1) } 50% { transform:scale(1.04) } }
  @keyframes slideUp { from { transform:translateY(100%) } to { transform:translateY(0) } }
`;
