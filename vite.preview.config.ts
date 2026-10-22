// ─── Design preview server (dev only) ──────────────────────────────
// `npx vite --config vite.preview.config.ts --host` then open
// /preview.html?tab=home. Swaps Firebase, wearables and AI calls for a
// made-up household (src/dev/preview) so screens render without sign-in.
import { defineConfig, mergeConfig, type Plugin } from "vite";
import path from "node:path";
import base from "./vite.config";

const r = (p: string) => path.resolve(__dirname, p);
const SWAPS: Record<string, string> = {
  [r("src/core/firebase.ts")]: r("src/dev/preview/fakeFirebase.ts"),
  [r("src/core/householdItems.ts")]: r("src/dev/preview/fakeHouseholdItems.ts"),
  [r("src/core/wellnessAutoTrack.ts")]: r("src/dev/preview/fakeWellness.ts"),
  [r("src/core/thriveCheckin.ts")]: r("src/dev/preview/fakeCheckin.ts"),
  [r("src/core/weather.ts")]: r("src/dev/preview/fakeWeather.ts"),
  [r("src/core/appleHealth.ts")]: r("src/dev/preview/fakeAppleHealth.ts"),
  [r("src/modules/briefing/generateBriefing.ts")]: r("src/dev/preview/fakeBriefing.ts"),
};
const FAKES = new Set(Object.values(SWAPS));

function previewSwaps(): Plugin {
  return {
    name: "hernest-preview-swaps",
    enforce: "pre",
    async resolveId(source, importer, opts) {
      if (!importer || FAKES.has(importer.split("?")[0])) return null; // a fake may import the real module
      const hit = await this.resolve(source, importer, { ...opts, skipSelf: true });
      const to = hit && SWAPS[hit.id.split("?")[0]];
      return to ?? null;
    },
  };
}

export default mergeConfig(base, defineConfig({ plugins: [previewSwaps()] }));
