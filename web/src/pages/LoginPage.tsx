import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { qk, useMe } from "../lib/queries";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const qc = useQueryClient();
  const location = useLocation();
  const rawFrom = (location.state as { from?: string } | null)?.from;
  // Only same-app paths; never back to /login itself.
  const from =
    rawFrom && rawFrom.startsWith("/") && !rawFrom.startsWith("//") && !rawFrom.includes("\\") && !rawFrom.startsWith("/login") ? rawFrom : "/";
  const me = useMe();

  const login = useMutation({
    mutationFn: () => api.auth.login(email.trim(), password),
    onSuccess: (user) => {
      qc.clear();
      // Setting `me` re-renders this page, and the <Navigate> below sends the user on to `from`.
      // (Navigating here as well raced that redirect and could drop the deep link.)
      qc.setQueryData(qk.me, user);
    },
  });

  if (me.data) return <Navigate to={from} replace />;

  const err = login.error;
  const message =
    err instanceof ApiError
      ? err.status === 429
        ? "Too many sign-in attempts. Wait 15 minutes, then try again."
        : err.status === 401
          ? "That email and password don't match. Check both and try again."
          : err.message
      : err
        ? "Can't reach the server. Check your connection and try again."
        : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    login.mutate();
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="snowfall relative bg-band px-6 pb-24 pt-[max(3.5rem,calc(env(safe-area-inset-top)+1.5rem))] text-band-ink">
        <div className="mx-auto max-w-sm">
          <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true" className="mb-5">
            <path d="M5 12h22v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="currentColor" opacity=".22" />
            <rect x="4" y="9" width="24" height="5" rx="1.5" fill="currentColor" />
            <rect x="14.5" y="9" width="3" height="19" fill="var(--berry)" />
            <path d="M16 9c-1.5-4-6.5-5.5-6.5-2.5 0 2 4 2.5 6.5 2.5Zm0 0c1.5-4 6.5-5.5 6.5-2.5 0 2-4 2.5-6.5 2.5Z" fill="none" stroke="var(--berry)" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          <h1 className="text-[40px] font-extrabold leading-[0.95] tracking-[-0.03em] [font-stretch:88%]">Gift List</h1>
          <p className="mt-3 max-w-[22rem] text-[17px] leading-snug opacity-90">Ideas, budgets, and who it's from. Just for the two of us.</p>
        </div>
      </div>

      <form onSubmit={submit} className="relative z-10 mx-auto -mt-14 w-full max-w-sm px-4 pb-10" noValidate>
        <div className="card space-y-4 p-5 shadow-[0_12px_40px_-18px_rgba(10,40,28,0.45)]">
          <div>
            <label htmlFor="email" className="label">Email</label>
            <input
              id="email"
              className="field"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="label">Password</label>
            <input
              id="password"
              className="field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {message && (
            <p role="alert" className={`rounded-xl px-4 py-3 text-[15px] font-medium ${err instanceof ApiError && err.status === 429 ? "bg-gold-soft text-gold" : "bg-berry-soft text-berry"}`}>
              {message}
            </p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={login.isPending || !email || !password}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
