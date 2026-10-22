// ─── Global styles ─────────────────────────────────────────────────
// Injected once by App (and the design preview).
import { T } from "../config/theme";

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

  /* Loading placeholders (Skeleton) */
  .hn-skeleton {
    background: linear-gradient(90deg, #ECE5D6 0%, #F6F1E6 50%, #ECE5D6 100%);
    background-size: 200% 100%;
    animation: hnShimmer 1.4s ease-in-out infinite;
  }
  @keyframes hnShimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }

  /* Press feedback on buttons, instant on touch-down */
  button:active:not(:disabled) { transform: scale(0.98); }

  /* Animations */
  @keyframes fadeUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
  @keyframes spin { to { transform:rotate(360deg) } }
  @keyframes breathe { 0%,100% { transform:scale(1) } 50% { transform:scale(1.04) } }
  @keyframes slideUp { from { transform:translateY(100%) } to { transform:translateY(0) } }
`;
