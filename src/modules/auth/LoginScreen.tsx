import React, { useState } from "react";
import { signInWithPopup, signInWithRedirect, GoogleAuthProvider } from "firebase/auth";
import { auth, googleProvider } from "../../core/firebase";
import { T, F } from "../../config/theme";
import { Button } from "../../shared/components";

export function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const signIn = async () => {
    setLoading(true);
    setError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      console.error("Auth error:", e.code, e.message);
      if (e.code === "auth/popup-blocked" || e.code === "auth/cancelled-popup-request") {
        try { await signInWithRedirect(auth, googleProvider); } catch {}
      } else if (e.code === "auth/unauthorized-domain") {
        setError("Domain not authorized. Please add hernest-v2.vercel.app to Firebase authorized domains.");
      } else {
        setError(`Sign in failed: ${e.code}`);
      }
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: T.esp, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
      {/* Logo */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: `linear-gradient(135deg, ${T.gold}, #8B6914)`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", boxShadow: "0 0 40px rgba(201,169,97,.4)" }}>
          <span style={{ fontSize: 32 }}>🪺</span>
        </div>
        <h1 style={{ fontFamily: F.serif, fontStyle: "italic", fontSize: 44, color: T.gold, fontWeight: 400, margin: "0 0 8px" }}>HerNest</h1>
        <p style={{ fontFamily: F.sans, fontSize: 13, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em" }}>Your AI chief of staff</p>
      </div>

      {/* Value props */}
      <div style={{ width: "100%", maxWidth: 340, marginBottom: 40 }}>
        {[
          { icon: "☀️", text: "A personalised briefing every morning" },
          { icon: "🧠", text: "Nora learns your family, goals & patterns" },
          { icon: "💰", text: "Budget, wellness, style — all connected" },
        ].map((v, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>{v.icon}</span>
            <p style={{ fontFamily: F.sans, fontSize: 14, color: "rgba(255,255,255,0.75)", lineHeight: 1.5, margin: 0 }}>{v.text}</p>
          </div>
        ))}
      </div>

      {/* Sign in */}
      <div style={{ width: "100%", maxWidth: 340 }}>
        <button
          onClick={signIn}
          disabled={loading}
          style={{
            width: "100%", padding: "14px 20px",
            background: "#fff", border: "none", borderRadius: 16,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
            fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: T.esp,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          }}
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width={20} height={20} alt="Google" />
          {loading ? "Signing in..." : "Continue with Google"}
        </button>

        {error && <p style={{ fontFamily: F.sans, fontSize: 12, color: "#ff6b6b", textAlign: "center", marginTop: 12 }}>{error}</p>}

        <p style={{ fontFamily: F.sans, fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 20, lineHeight: 1.6 }}>
          By continuing you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}
