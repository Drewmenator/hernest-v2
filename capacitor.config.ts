import type { CapacitorConfig } from "@capacitor/cli";

// HerNest iOS shell. Bundles the built web app (webDir: dist) so the app
// works offline and is a proper native binary — the right base for push
// notifications and HealthKit later.
//
// NOTE: change `appId` to your final reverse-DNS bundle id before the first
// App Store Connect record (it can't change after). Update it in Xcode too.
const config: CapacitorConfig = {
  appId: "com.hernest.app",
  appName: "HerNest",
  webDir: "dist",
  backgroundColor: "#2A1F18",
  ios: {
    contentInset: "always",
    backgroundColor: "#2A1F18",
  },
};

export default config;
