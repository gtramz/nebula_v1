import { ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { BottomTabs } from "./bottom-tabs";
import { MobileHeader } from "./mobile-header";
import { SiteFooter } from "./site-footer";
import { TopNav } from "./top-nav";

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();

  const isAuthForm = location === "/login" || location === "/register";
  const isLanding = location === "/";
  const isProfile = location.startsWith("/profile");

  const showNav = !isLoading && !isAuthForm && (isAuthenticated || !isLanding);
  const showTabs = !isLoading && !isAuthForm && (isAuthenticated || !isLanding);

  return (
    <div className="relative flex min-h-[100dvh] justify-center bg-bg lg:block">
      <div className="relative flex min-h-[100dvh] w-full flex-col mx-auto">
        {showNav && <TopNav />}
        {showNav && <MobileHeader />}
        <div className={`relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden ${showTabs ? "pb-32 lg:pb-7" : "pb-10 lg:pb-7"}`}>
          {children}
        </div>
        {showTabs && <BottomTabs />}
        <SiteFooter />
      </div>
    </div>
  );
}

export function ContentWidth({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-5xl px-6 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}
