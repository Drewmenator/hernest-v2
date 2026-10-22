import React, { useState } from "react";
import { T, F } from "../../config/theme";
import { signInWithGoogle, signInWithApple } from "../../core/nativeAuth";

export function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [status, setStatus]   = useState("");

  const signIn = async (method: typeof signInWithGoogle) => {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      await method(setStatus);
    } catch (e: any) {
      // Ignore user-initiated cancels (web popup close or native sheet dismiss);
      // surface everything else as a retry prompt. Apple's native cancel is
      // ASAuthorizationError code 1001.
      const cancelled = e?.code === "auth/popup-closed-by-user" || e?.code === "1" || e?.code === "1001"
        || /cancel/i.test(e?.message || "");
      if (!cancelled) {
        // Include the error code so on-device failures are diagnosable without
        // a debugger attached (e.g. auth/operation-not-allowed, network errors).
        const detail = e?.code || e?.message || "unknown";
        setError(`Sign in failed: ${detail}`);
        console.error("[Auth] sign-in failed:", e);
      }
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100svh", background:`linear-gradient(160deg,${T.esp} 0%,#16314A 100%)`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px" }}>
      <div style={{ textAlign:"center", marginBottom:48 }}>
        <h1 style={{ fontFamily:F.serif, fontSize:52, fontWeight: 700, color:T.gold, margin:"0 0 8px", letterSpacing:"-0.01em" }}>HerNest</h1>
        <p style={{ fontFamily:F.sans, fontSize:13, color:"rgba(255,255,255,0.45)", letterSpacing:"0.18em", textTransform:"uppercase", margin:0 }}>Your AI Chief of Staff</p>
      </div>

      <div style={{ width:"100%", maxWidth:340 }}>
        {/* Apple's button guidelines: black or white, Apple logo, "Continue
            with Apple", same size as other sign-in buttons. */}
        <button
          onClick={() => signIn(signInWithApple)}
          disabled={loading}
          aria-label="Continue with Apple"
          style={{ width:"100%", padding:"16px 20px", background:"#000", border:"1px solid rgba(255,255,255,0.35)", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", gap:12, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, minHeight:56, touchAction:"manipulation", marginBottom:12 }}
        >
          <svg width="18" height="22" viewBox="0 0 814 1000" aria-hidden="true">
            <path fill="#fff" d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-164-40c-77 0-104 41-167 41s-106-58-156-128C44 790 0 669 0 554c0-184 120-282 238-282 63 0 115 41 155 41 38 0 97-44 169-44 27 0 126 3 226 72zM554 167c29-35 50-83 50-131 0-7-1-13-2-19-47 2-104 32-138 72-27 30-52 79-52 128 0 7 1 15 2 17 3 1 8 2 13 2 43 0 96-29 127-69z"/>
          </svg>
          <span style={{ fontFamily:F.sans, fontSize:15, fontWeight:600, color:"#fff" }}>
            Continue with Apple
          </span>
        </button>

        <button
          onClick={() => signIn(signInWithGoogle)}
          disabled={loading}
          style={{ width:"100%", padding:"16px 20px", background:"#fff", border:"none", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", gap:12, cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1, minHeight:56, touchAction:"manipulation" }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.6 29.3 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l5.7-5.7C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.3-.2-2.7-.4-4z"/>
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.5 15.2 18.9 12 24 12c3.1 0 5.9 1.1 8.1 2.9l5.7-5.7C34.6 5.1 29.6 3 24 3c-7.6 0-14.2 4.1-17.7 10.3z" opacity=".8"/>
            <path fill="#4CAF50" d="M24 45c5.5 0 10.5-2 14.2-5.3l-6.6-5.4C29.6 36 26.9 37 24 37c-5.2 0-9.6-3.4-11.2-8l-6.6 5.1C9.8 40.8 16.4 45 24 45z"/>
            <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.4l6.6 5.4c3.8-3.5 6.3-8.7 6.3-14.8 0-1.3-.2-2.7-.4-4z"/>
          </svg>
          <span style={{ fontFamily:F.sans, fontSize:15, fontWeight:600, color:"#1a1a1a" }}>
            Continue with Google
          </span>
        </button>

        {loading && <p style={{ fontFamily:F.sans, fontSize:13, color:"rgba(255,255,255,0.7)", textAlign:"center", marginTop:16 }}>Signing in…</p>}
        {loading && status && <p style={{ fontFamily:F.sans, fontSize:12, color:"rgba(255,255,255,0.6)", textAlign:"center", marginTop:16 }}>{status}</p>}

        {error && <p style={{ fontFamily:F.sans, fontSize:13, color:T.blush, textAlign:"center", marginTop:16, wordBreak:"break-word" }}>{error}</p>}

        <p style={{ fontFamily:F.sans, fontSize: 12, color:"rgba(255,255,255,0.25)", textAlign:"center", marginTop:32, lineHeight:1.6 }}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
