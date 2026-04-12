"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { auth as authApi } from "@/lib/api";
import { Suspense } from "react";

function CallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      setError("No authorization code received");
      return;
    }

    authApi
      .githubCallback(code)
      .then((result) => {
        login(result.access_token, result.user);
        router.push("/dashboard");
      })
      .catch((err) => {
        setError(err.message || "GitHub authentication failed");
      });
  }, [params, login, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card p-8 max-w-md text-center space-y-4">
          <p className="text-danger">{error}</p>
          <a href="/auth" className="btn-primary inline-block">
            Try Again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto" />
        <p className="text-text-secondary">Connecting GitHub account...</p>
      </div>
    </div>
  );
}

export default function GitHubCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-pulse text-text-secondary">Loading...</div>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
