import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useLogin, isServerMode, transferBrowserAccount, initializeLocalStore } from "@nebula/local";
import { Loader2 } from "lucide-react";
import { AntiqLogo } from "@/components/antiq-logo";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');

  const handleLogin = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ data: { email, password } }, {
      onSuccess: (user) => { setLocation(user.role === "artist" ? "/profile" : "/explore"); },
    });
  };

  return (
    <div className="flex flex-1 flex-col p-6 items-center justify-center relative">
      <Link href="/" aria-label="back home" className="absolute left-16 top-6 z-50">
        <AntiqLogo className="h-9 w-6" imageScaleClass="h-[272%] w-auto" backArrow />
      </Link>
      <div className="w-full max-w-sm flex flex-col gap-8">
        <h1 aria-label="Antiq Nebula" className="flex items-center justify-center gap-4 text-5xl sm:text-6xl font-display font-bold tracking-tighter text-ink">
          <span aria-hidden="true">
            <AntiqLogo className="h-14 w-9" imageScaleClass="h-[272%] w-auto" />
          </span>
          nebula
        </h1>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <label className="space-y-2">
            <span className="text-[10px] voice text-muted">email</span>
            <input type="email" autoComplete="username" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required
              className="w-full bg-surfaceAlt border border-border px-6 py-4 text-ink focus:outline-none focus:border-ink transition" />
          </label>
          <label className="space-y-2">
            <span className="text-[10px] voice text-muted">password</span>
            <input type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required
              className="w-full bg-surfaceAlt border border-border px-6 py-4 text-ink focus:outline-none focus:border-ink transition" />
          </label>
          <button type="submit" disabled={login.isPending}
            className="w-full py-4 mt-2 bg-cream text-bg font-bold voice text-xs flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-white transition">
            {login.isPending && <Loader2 className="w-4 h-4 animate-spin" />} log in
          </button>
          {login.isError && <p role="alert" className="text-danger text-sm text-center">{login.error.message}</p>}
        </form>
        {isServerMode() && <div className="text-center space-y-2">
          <button className="text-xs text-muted underline disabled:opacity-50" disabled={transferring || login.isPending} onClick={async () => {
            setTransferring(true); setTransferError('');
            try { await transferBrowserAccount({ email, password }); await initializeLocalStore(); setLocation('/profile'); }
            catch (error) { setTransferError(error instanceof Error ? error.message : 'Could not transfer this account.'); }
            finally { setTransferring(false); }
          }}>{transferring ? 'Transferring…' : 'Transfer my browser-only account'}</button>
          <p className="text-xs text-muted">Enter its email and password above. Only your profile is transferred; old browser data stays intact.</p>
          {transferError && <p role="alert" className="text-danger text-sm">{transferError}</p>}
        </div>}
        <p className="text-center text-muted text-sm">don't have a profile? <Link href="/register" className="text-cream hover:underline font-medium">sign up</Link></p>
      </div>
    </div>
  );
}
