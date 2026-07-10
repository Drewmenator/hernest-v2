# Shipping HerNest to TestFlight

HerNest now has a **native iOS shell** (Capacitor) that wraps the built web app.
The Xcode project compiles cleanly (`BUILD SUCCEEDED`, verified). This guide takes
you from that shell to testers' phones.

> **Login works.** Native Google Sign-In is wired (`@capacitor-firebase/authentication`,
> `GoogleService-Info.plist` bundled, verified building with the Firebase SDK linked).
> Nothing else is required before testers can log in. The section below is kept as a
> record of what was done / what to redo if you change the bundle id.

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

## Native Google Sign-In — DONE (how it works / redo notes)

HerNest authenticates only with Google (Firebase Auth). Google **blocks OAuth
inside embedded webviews**, so the web `signInWithPopup` flow can't run on device.
This is already solved:

- `@capacitor-firebase/authentication` (skipNativeAuth) does the native Google
  handshake and hands the ID token back to JS; `src/core/nativeAuth.ts` exchanges
  it for a Firebase credential on the same JS auth instance, so auth state and the
  onboarding gate behave exactly as on web.
- `GoogleService-Info.plist` is bundled (registered in the Xcode project), and the
  `REVERSED_CLIENT_ID` URL scheme is in `Info.plist`.
- Verified: `xcodebuild` succeeds with the Firebase SDK linked; the plist and URL
  scheme are present in the built `.app`.

**If you ever change the bundle id**, you must re-register the iOS app in Firebase
under the new id, download a fresh `GoogleService-Info.plist` into `ios/App/App/`,
and update the `REVERSED_CLIENT_ID` URL scheme in `Info.plist` to match.

(A **PWA "Add to Home Screen"** install — open the Vercel URL in Safari → Share →
Add to Home Screen — also works today with Google login, if you want eyes on it
before finishing the Apple Developer enrolment. TestFlight is still the path for
push notifications + HealthKit.)

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
