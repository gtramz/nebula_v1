import { useMemo, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useRegisterAccount, isServerMode } from "@nebula/local";
import { Check, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { AntiqLogo } from "@/components/antiq-logo";
import { MorphAdvanceButton } from "@/components/blob-face";

type RegistrationStep = 1 | 2 | 3;

export default function Register() {
  const [, setLocation] = useLocation();
  const [role, setRole] = useState<"none" | "investor" | "artist">("none");
  const [step, setStep] = useState<RegistrationStep>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [attemptedNext, setAttemptedNext] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const registerAccount = useRegisterAccount();

  const passwordChecks = useMemo(() => [
    { label: "8 or more characters", valid: password.length >= 8 },
    { label: "128 characters or fewer", valid: password.length > 0 && password.length <= 128 },
  ], [password]);

  const isNameValid = name.trim().length >= 2;
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isPasswordValid = password.length >= 8 && password.length <= 128;
  const isConfirmationValid = password === confirmPassword && confirmPassword.length > 0;

  const handleRegister = (e: FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid || !isConfirmationValid) {
      setAttemptedNext(true);
      return;
    }
    if (role === "none") return;
    registerAccount.mutate({ data: { name, email, password, role } }, {
      onSuccess: () => {
        setLocation(role === "artist" ? "/profile" : "/explore");
      }
    });
  };

  const handleNext = (e: FormEvent) => {
    e.preventDefault();
    const valid = validateCurrentStep();
    if (valid) {
      advanceCurrentStep();
    }
  };

  const validateCurrentStep = () => {
    setAttemptedNext(true);
    return step === 1 ? isNameValid : isEmailValid;
  };

  const advanceCurrentStep = () => {
    setAttemptedNext(false);
    setStep((current) => (current + 1) as RegistrationStep);
  };

  const handleBack = () => {
    if (step === 1 && !advancing) {
      setRole("none");
      return;
    }
    if (advancing) return;
    setAttemptedNext(false);
    setStep((current) => (current - 1) as RegistrationStep);
  };

  if (role === "none") {
    return (
      <div className="flex flex-1 flex-col p-6 items-center justify-center relative">
        <Link
          href="/"
          aria-label="back home"
          className="absolute left-16 top-6 z-50"
        >
          <AntiqLogo
            className="h-9 w-6"
            imageScaleClass="h-[272%] w-auto"
            backArrow
          />
        </Link>
        <div className="flex w-full max-w-md flex-col gap-10 lg:max-w-3xl lg:gap-14">
          <div className="space-y-2 text-center lg:space-y-4">
             <h1 className="text-4xl font-display font-bold text-ink text-veil lg:text-6xl">join nebula</h1>
             <p className="text-muted lg:text-lg">how would you like to use the platform?</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => setRole("investor")}
               className="flex flex-col items-start gap-4 p-6 border border-border text-left hover:bg-white/[0.02] transition"
            >
              <div>
                  <h3 className="font-bold text-base text-ink">investor</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">fund projects and support independent music.</p>
              </div>
            </button>

            <button
              onClick={() => setRole("artist")}
               className="group flex flex-col items-start gap-4 p-6 border border-[#18d9ff] text-[#18d9ff] text-left hover:bg-[#18d9ff] hover:text-bg transition"
            >
              <div>
                  <h3 className="font-bold text-base text-ink">artist</h3>
                 <p className="mt-1 text-xs leading-relaxed text-[#18d9ff]/70 transition-colors group-hover:text-bg">create an artist profile and try funding rounds.</p>
              </div>
            </button>
          </div>

          <p className="text-center text-muted text-sm">
             already have an account? <Link href="/login" className="text-cream hover:underline font-medium">log in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6 relative">
      <AntiqLogo
        className="!absolute left-16 top-6 z-50 h-9 w-6"
        imageScaleClass="h-[272%] w-auto"
        backArrow
        onClick={handleBack}
      />

      <div className="flex w-full max-w-md flex-col gap-8">
        <div className="space-y-5">
          <div className="flex items-center justify-between text-[10px] text-muted voice">
            <span>{role} profile</span>
          </div>
          <div className="grid grid-cols-3 gap-2" aria-label={`registration progress, step ${step} of 3`}>
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className={`h-1 transition-colors duration-300 ${
                  item <= step ? "bg-[#18d9ff]" : "bg-white/15"
                }`}
              />
            ))}
          </div>
        </div>

        <form
          onSubmit={step === 3 ? handleRegister : handleNext}
          className="flex flex-col gap-8"
        >
          <div key={step} className="animate-[expand-in_220ms_ease-out]">
            {step === 1 && (
              <div className="space-y-7">
                <div className="space-y-2">
                  <p className="text-[10px] text-[#18d9ff] voice">01 / identity</p>
                  <h1 className="text-4xl font-display font-bold tracking-tight text-ink text-veil">
                    let&apos;s get to know you
                  </h1>
                  <p className="text-muted">start with the name you want to use on nebula.</p>
                </div>
                <label className="block space-y-3">
                  <span className="text-[10px] text-muted voice">full name</span>
                  <input
                    autoFocus
                    type="text"
                    maxLength={120}
                    placeholder="your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={`w-full border bg-surfaceAlt px-5 py-4 text-ink placeholder-muted outline-none transition-colors ${
                      attemptedNext && !isNameValid ? "border-danger" : "border-white/15 focus:border-[#18d9ff]"
                    }`}
                    aria-invalid={attemptedNext && !isNameValid}
                    aria-required="true"
                  />
                  {attemptedNext && !isNameValid && (
                    <span className="block text-xs text-danger">enter at least 2 characters.</span>
                  )}
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-7">
                <div className="space-y-2">
                  <p className="text-[10px] text-[#18d9ff] voice">02 / contact</p>
                  <h1 className="text-4xl font-display font-bold tracking-tight text-ink text-veil">
                    where can we reach you?
                  </h1>
                  <p className="text-muted">we&apos;ll use this to keep your account secure.</p>
                </div>
                <label className="block space-y-3">
                  <span className="text-[10px] text-muted voice">email address</span>
                  <input
                    autoFocus
                    type="text"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={254}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`w-full border bg-surfaceAlt px-5 py-4 text-ink placeholder-muted outline-none transition-colors ${
                      attemptedNext && !isEmailValid ? "border-danger" : "border-white/15 focus:border-[#18d9ff]"
                    }`}
                    aria-invalid={attemptedNext && !isEmailValid}
                    aria-required="true"
                  />
                  {attemptedNext && !isEmailValid && (
                    <span className="block text-xs text-danger">enter a valid email address.</span>
                  )}
                </label>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-7">
                <div className="space-y-2">
                  <p className="text-[10px] text-[#18d9ff] voice">03 / security</p>
                  <h1 className="text-4xl font-display font-bold tracking-tight text-ink text-veil">
                    make it yours
                  </h1>
                  <p className="text-muted">create a password to protect your preview profile.</p>
                </div>
                <div className="space-y-4">
                  <label className="block space-y-3">
                    <span className="text-[10px] text-muted voice">password</span>
                    <span className="relative block">
                      <input
                        autoFocus
                        type={showPassword ? "text" : "password"}
                        aria-label="password"
                        autoComplete="new-password"
                        maxLength={128}
                        placeholder="8 characters minimum"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`w-full border bg-surfaceAlt px-5 py-4 pr-14 text-ink placeholder-muted outline-none transition-colors ${
                          attemptedNext && !isPasswordValid ? "border-danger" : "border-white/15 focus:border-[#18d9ff]"
                        }`}
                        aria-required="true"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((visible) => !visible)}
                        aria-label={showPassword ? "hide password" : "show password"}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                  </label>
                  <label className="block space-y-3">
                    <span className="text-[10px] text-muted voice">confirm password</span>
                    <span className="relative block">
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        aria-label="confirm password"
                        autoComplete="new-password"
                        maxLength={128}
                        placeholder="repeat your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`w-full border bg-surfaceAlt px-5 py-4 pr-14 text-ink placeholder-muted outline-none transition-colors ${
                          attemptedNext && !isConfirmationValid ? "border-danger" : "border-white/15 focus:border-[#18d9ff]"
                        }`}
                        aria-required="true"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((visible) => !visible)}
                        aria-label={showConfirmPassword ? "hide password confirmation" : "show password confirmation"}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                  </label>
                  <div className="grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-3">
                    {passwordChecks.map((check) => (
                      <div key={check.label} className={`flex items-center gap-2 text-[10px] ${check.valid ? "text-[#18d9ff]" : "text-muted"}`}>
                        <Check className={`h-3 w-3 ${check.valid ? "opacity-100" : "opacity-30"}`} />
                        <span>{check.label}</span>
                      </div>
                    ))}
                  </div>
                  {attemptedNext && !isConfirmationValid && (
                    <p className="text-xs text-danger">
                      {isPasswordValid ? "passwords do not match." : "use at least 8 characters."}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                disabled={advancing}
                className="border border-white/15 px-5 py-4 text-xs text-muted transition-colors hover:border-white/40 hover:text-ink"
              >
                back
              </button>
            )}
            {step < 3 ? (
              <MorphAdvanceButton
                className="flex-1"
                buttonClassName="flex w-full items-center justify-center gap-2 bg-cream px-5 py-4 text-xs font-bold text-bg transition-colors hover:bg-white"
                invalid={step === 1 ? !isNameValid : !isEmailValid}
                onBeforeAdvance={validateCurrentStep}
                onAdvance={advanceCurrentStep}
                onPendingChange={setAdvancing}
              >
                continue
              </MorphAdvanceButton>
            ) : (
              <button
                type="submit"
                disabled={registerAccount.isPending || advancing}
                className="flex flex-1 items-center justify-center gap-2 bg-cream px-5 py-4 text-xs font-bold text-bg transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-50"
              >
                {registerAccount.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {registerAccount.isPending ? "creating account" : "create account"}
              </button>
            )}
          </div>

          {step === 3 && (
            <div className="flex items-start gap-3 border-t border-white/10 pt-5 text-xs text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#18d9ff]" />
              <p>{isServerMode() ? 'your account is saved on this server. sign in with the same email and password from any browser that can reach it.' : 'your account is saved in this browser for this local preview. use the same browser and address to log in again.'}</p>
            </div>
          )}

          {registerAccount.isError && (
            <p className="text-center text-sm font-medium text-danger">
              {registerAccount.error?.message ?? "This profile could not be created."}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
