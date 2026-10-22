// ─── Design preview ────────────────────────────────────────────────
// Open /preview.html?tab=home|budget|thrive|plan|cleo (add &flat=1 for no texture) with
// `npx vite --config vite.preview.config.ts` to see the real screens with a
// made-up household, no sign-in needed (also from the iOS Simulator's
// Safari). Dev only: the app build never includes this file.
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { useStore } from "../../core/store";
import { globalStyles } from "../../shared/globalStyles";
import { AppShell } from "../../AppShell";
import { LoginScreen } from "../../modules/auth/LoginScreen";
import { PREVIEW_UID } from "./sampleData";
import { startAppearance, setAppearance } from "../../shared/appearance";

const params = new URLSearchParams(location.search);
const tab = params.get("tab") || "home";
// ?flat=1 turns the paper texture off, to compare textured and flat.
if (params.get("flat")) document.documentElement.classList.add("hn-flat");
// ?theme=dark|light pins the appearance for screenshots.
// &plan=week|school|meals opens that Plan segment.
if (params.get("plan")) { try { sessionStorage.setItem("hn_plan_tab", params.get("plan")!); } catch { /* private mode */ } }
const theme = params.get("theme");
if (theme === "dark" || theme === "light") setAppearance(theme); else startAppearance();
const s = useStore.getState();
s.setUser({ uid: PREVIEW_UID, email: "preview@example.com", displayName: "Jess Rivera" });
s.setProfile({ name: "Jess Rivera", kids: [{ name: "Maya" }, { name: "Leo" }] } as never);
s.setScreen("app");
s.setActiveTab(tab);

createRoot(document.getElementById("root")!).render(
  <>
    <style>{globalStyles}</style>
    {/* ?screen=login shows the sign-in screen instead of the app. */}
    {params.get("screen") === "login" ? <LoginScreen /> : <BrowserRouter><AppShell /></BrowserRouter>}
  </>,
);
