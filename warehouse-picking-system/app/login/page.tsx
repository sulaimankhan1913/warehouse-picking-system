"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) { setMessage("Supabase has not been connected yet."); return; }
    setLoading(true); setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setMessage(error.message); return; }
    router.replace("/"); router.refresh();
  }

  return (
    <main className="login-shell">
      <section className="login-art">
        <div className="brand" style={{ margin: 0 }}><div className="brand-mark">NW</div><div><div className="brand-name">Northstar</div><div className="brand-sub">Warehouse ops</div></div></div>
        <h1>Every order, moving with certainty.</h1>
        <p>Live picking, packing, barcode verification, and complete accountability from upload to dispatch.</p>
      </section>
      <section className="login-form-side">
        <form className="login-card" onSubmit={signIn}>
          <p className="eyebrow">Secure access</p>
          <h2>Welcome back</h2>
          <p className="subtitle">Sign in with your warehouse account.</p>
          <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {message && <p className="login-error">{message}</p>}
          <button className="primary-button" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}
