// ─── Design preview ────────────────────────────────────────────────
// Open /preview.html?tab=home|budget|thrive|plan|cleo with
// `npx vite --config vite.preview.config.ts` to see the real screens with a
// made-up household, no sign-in needed (also from the iOS Simulator's
// Safari). Dev only: the app build never includes this file.
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { useStore } from "../../core/store";
import { globalStyles } from "../../shared/globalStyles";
import { AppShell } from "../../AppShell";
import { PREVIEW_UID } from "./sampleData";

const tab = new URLSearchParams(location.search).get("tab") || "home";
const s = useStore.getState();
s.setUser({ uid: PREVIEW_UID, email: "preview@example.com", displayName: "Jess Rivera" });
s.setProfile({ name: "Jess Rivera", kids: [{ name: "Maya" }, { name: "Leo" }] } as never);
s.setScreen("app");
s.setActiveTab(tab);

createRoot(document.getElementById("root")!).render(
  <>
    <style>{globalStyles}</style>
    <BrowserRouter><AppShell /></BrowserRouter>
  </>,
);
