// ─── Global styles ─────────────────────────────────────────────────
// Injected once by App (and the design preview).
import { T, MOTION, GRAIN, themeCss } from "../config/theme";

export const globalStyles = `
  ${themeCss()}
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
    background: ${T.bg};
    color: ${T.text};
    font-family: 'DM Sans', sans-serif;
    overflow-x: hidden;
    overflow-y: auto;
    min-height: 100%;
    min-height: -webkit-fill-available;
    /* Smooth momentum scrolling on iOS */
    -webkit-overflow-scrolling: touch;
  }
  
  /* The page: each tab's own light (Today lavender-ivory, Plan powder
     blue, Cleo violet silk, Bills pearl sage, Me blush dawn) in both
     themes, the tab's artwork when it has one, and a fine grain on top.
     Fixed layers behind everything, painted once (they never move while
     scrolling). html.hn-flat turns them off for comparison. */
  body::before, body::after {
    content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  }
  body::before {
    background:
      var(--hn-page-scrim),
      var(--hn-page-art) center top / cover no-repeat,
      radial-gradient(80% 50% at 100% 0%, var(--hn-page-a) 0%, transparent 72%),
      radial-gradient(60% 40% at 0% 100%, var(--hn-page-b) 0%, transparent 70%),
      linear-gradient(180deg, var(--hn-page-top) 0%, ${T.bg} 45%, var(--hn-page-bottom) 100%);
  }
  body::after { background-image: ${GRAIN}; background-size: 160px 160px; opacity: var(--hn-grain-opacity); }
  html.hn-flat body::before { background: ${T.bg}; }
  html.hn-flat body::after { display: none; }

  /* Fine grain inside a card (Cleo's hero only), kept under the text. */
  .hn-grain { isolation: isolate; }
  .hn-grain::after {
    content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; border-radius: inherit;
    background-image: ${GRAIN}; background-size: 160px 160px; opacity: var(--hn-grain-opacity);
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
  .hn-skeleton { position: relative; overflow: hidden; background: ${T.sand}; }
  .hn-skeleton::after {
    content: ""; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent 0%, ${T.glassStrong} 50%, transparent 100%);
    transform: translateX(-100%);
    animation: hnShimmer 1.5s ease-in-out infinite;
  }
  .hn-skeleton.on-tint { background: ${T.glass}; }
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
