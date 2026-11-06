import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useLogin } from "@nebula/local";
import { Loader2 } from "lucide-react";
import { AntiqLogo } from "@/components/antiq-logo";

export default function Login() {
  const [, setLocation] = useLocation();
  const [role, setRole] = useState<"investor" | "artist">("investor");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  const handleLogin = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ data: { email, password, role } }, {
      onSuccess: () => { setLocation(role === "artist" ? "/profile" : "/explore"); },
    });
  };

  return (
    <div className="flex flex-1 flex-col p-6 items-center justify-center relative">
      <Link href="/" aria-label="back home" className="absolute left-16 top-6 z-50">
        <AntiqLogo className="h-9 w-6" imageScaleClass="h-[272%] w-auto" backArrow />
      </Link>
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-display font-bold text-ink text-veil">welcome back</h1>
          <p className="text-muted">continue with a profile created in this tab.</p>
        </div>
        <div role="group" aria-label="profile type" className="grid grid-cols-2 gap-3">
          {(["investor", "artist"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={role === item} onClick={() => { setRole(item); login.reset(); }}
              className={`py-3 border text-xs voice transition ${role === item ? "border-[#18d9ff] text-[#18d9ff]" : "border-border text-muted"}`}>
              {item}
            </button>
          ))}
        </div>
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
        <p className="text-center text-muted text-sm">don't have a profile? <Link href="/register" className="text-cream hover:underline font-medium">sign up</Link></p>
      </div>
    </div>
  );
}
