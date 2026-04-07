import { SiteHeader } from "@/components/site-header";
import { auth } from "@/lib/auth/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Fecal Classification to access your clinician dashboard.",
};

export default async function LoginPage() {
  const { data: session } = await auth.getSession();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
        <LoginForm />
      </main>
    </div>
  );
}
