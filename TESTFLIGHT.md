# Shipping HerNest to TestFlight

HerNest now has a **native iOS shell** (Capacitor) that wraps the built web app.
The Xcode project compiles cleanly (`BUILD SUCCEEDED`, verified). This guide takes
you from that shell to testers' phones.

> **Read the "Login blocker" section before inviting testers.** The shell builds
> and uploads today, but Google Sign-In will not work inside the webview until
> native auth is wired. That's the one remaining functional gap.

---

## What's in the repo

- `capacitor.config.ts` — app id `com.hernest.app`, bundles `dist/`.
- `ios/App/` — the Xcode project (`App.xcodeproj`, Swift Package Manager, app icon + splash).
- npm scripts:
  - `npm run ios:sync` — rebuild the web app and copy it into the iOS project.
  - `npm run ios:open` — open the project in Xcode.

**Golden rule:** every time you change web code, run `npm run ios:sync` before
building in Xcode. Otherwise Xcode ships a stale bundle.

---

## One-time setup

1. **Apple Developer Program** — enrol at <https://developer.apple.com/programs/>
   ($99/yr). Required for TestFlight; the free tier can't distribute.
2. **Finalize the bundle id.** `com.hernest.app` is a placeholder. Pick your real
   reverse-DNS id (it can never change once an App Store Connect record exists),
   then set it in **both** `capacitor.config.ts` (`appId`) and Xcode
   (target **App → Signing & Capabilities → Bundle Identifier**). Re-run `npm run ios:sync`.
3. **Signing.** In Xcode, target **App → Signing & Capabilities**, tick
   *Automatically manage signing*, and pick your Team. Xcode creates the
   provisioning profile.

---

## Login blocker — native Google Sign-In (do this before testers)

HerNest authenticates only with Google (Firebase Auth). Google **blocks OAuth
inside embedded webviews** (`disallowed_useragent`), which is exactly what the
Capacitor shell is. So the web `signInWithPopup` flow will fail on device.

The fix is a native sign-in that hands a credential to Firebase. Split of work:

**You (Firebase console — I can't do these):**
1. Firebase console → Project settings → **Add app → iOS**, using your final bundle id.
2. Download **`GoogleService-Info.plist`**.
3. Drop it into `ios/App/App/` in Xcode (check *Copy items if needed*).

**Then the code side (I can do this once the plist exists):**
4. Add `@capacitor-firebase/authentication` + the Google provider, register the
   plugin, and add the `REVERSED_CLIENT_ID` URL scheme to `Info.plist`.
5. Branch auth on `Capacitor.isNativePlatform()`: native path calls the plugin's
   Google sign-in, then `signInWithCredential` on the existing Firebase instance;
   web path stays as-is. No change to session handling downstream.

Until step 4–5 land, testers can open the app but not log in. If you want a
first look sooner without native auth, the **PWA "Add to Home Screen"** path
(open the deployed Vercel URL in Safari → Share → Add to Home Screen) gives a
full-screen install with working Google login today — no Apple Developer account
needed. TestFlight is the right call for push notifications + HealthKit later.

---

## Build & upload

1. `npm run ios:sync`
2. `npm run ios:open`
3. In Xcode, set the run destination to **Any iOS Device (arm64)** (not a simulator).
4. **Product → Archive.** When it finishes, the Organizer opens.
5. **Distribute App → TestFlight (Internal Only)** → follow the prompts to upload.
6. In **App Store Connect → your app → TestFlight**, the build appears after
   processing (5–15 min). Add internal testers (up to 100, no Apple review) or
   set up an external group (needs a short Beta App Review).
7. Testers install **TestFlight** from the App Store, accept the invite, tap Install.

---

## Every subsequent build

```
npm run ios:sync          # rebuild web + copy into iOS
# Xcode: bump build number, Product → Archive → Distribute → TestFlight
```

That's it — the web app is the source of truth; the native shell just carries it.
