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
  plugins: {
    // Native Google Sign-In. Google blocks OAuth inside embedded webviews, so
    // the web signInWithPopup flow can't run on device. The native plugin does
    // the Google handshake, and skipNativeAuth: true means it hands the ID token
    // back to JS — we exchange it for a Firebase credential on the same JS auth
    // instance the whole app already reads from, so nothing downstream changes.
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com"],
    },
  },
};

export default config;
