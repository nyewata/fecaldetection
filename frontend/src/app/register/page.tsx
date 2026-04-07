import { SiteHeader } from "@/components/site-header";
import { auth } from "@/lib/auth/server";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Register",
  description: "Create a Fecal Classification account to upload slides and run predictions.",
};

export default async function RegisterPage() {
  const { data: session } = await auth.getSession();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
        <RegisterForm />
      </main>
    </div>
  );
}
