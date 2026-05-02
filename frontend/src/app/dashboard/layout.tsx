"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import Sidebar from "@/components/ui/Sidebar";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { OnboardingTour } from "@/components/ui/OnboardingTour";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useGlobalShortcuts();
  useEffect(() => { if (!loading && !user) router.replace("/auth"); }, [user, loading, router]);

  if (loading || !user) return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-label="Loading" />
    </div>
  );

  return (
    <div className="flex min-h-screen relative">
      {/* Subtle ambient accent — top-right corner */}
      <div className="fixed top-0 right-0 w-[600px] h-[600px] pointer-events-none z-0"
        style={{ background: "radial-gradient(circle, rgba(124,107,255,0.08), transparent 60%)", filter: "blur(60px)" }}
        aria-hidden="true" />
      <Sidebar />
      <main id="main-content" className="relative z-10 flex-1 lg:ml-64 p-5 sm:p-8 animate-fade-in">
        {children}
      </main>
      <CommandPalette />
      <OnboardingTour />
    </div>
  );
}
