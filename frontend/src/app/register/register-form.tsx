"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buttonVariants } from "@/components/ui/button-variants";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { CheckCircle2, Microscope } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { signUpWithEmail, type RegisterFormState } from "./actions";

export function RegisterForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    RegisterFormState,
    FormData
  >(signUpWithEmail, null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const success = state != null && "success" in state && state.success === true;

  useEffect(() => {
    if (!success) return;

    void authClient.signOut().catch(() => {});

    redirectTimerRef.current = setTimeout(() => {
      router.push("/login");
    }, 3000);

    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, [success, router]);

  return (
    <Card className="w-full max-w-md border-border/80 shadow-sm">
      <CardHeader className="items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted/50">
          <Microscope className="size-6 text-foreground/70" aria-hidden />
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Create your account
        </CardTitle>
        <CardDescription className="text-balance">
          Register to access slide uploads, staged predictions, and the
          clinician dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {success ? (
          <div
            className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 px-6 py-10 text-center"
            role="status"
          >
            <CheckCircle2
              className="size-12 text-emerald-600 dark:text-emerald-500"
              aria-hidden
            />
            <p className="text-base font-medium text-foreground">
              Account created successfully
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Redirecting you to sign in shortly. Use your new email and password
              to log in.
            </p>
            <Link
              href="/login"
              className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
            >
              Go to sign in now
            </Link>
          </div>
        ) : (
          <form className="space-y-4" action={formAction}>
            <div className="space-y-2">
              <Label htmlFor="reg-name">Full name</Label>
              <Input
                id="reg-name"
                name="name"
                autoComplete="name"
                placeholder="Dr. Jane Smith"
                className="h-9"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-email">Work email</Label>
              <Input
                id="reg-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@hospital.org"
                className="h-9"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-password">Password</Label>
              <Input
                id="reg-password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                className="h-9"
                required
                minLength={8}
              />
            </div>
            {state != null && "error" in state ? (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}
            <Button type="submit" className="h-9 w-full" disabled={pending}>
              {pending ? "Creating account…" : "Create account"}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-4 border-t border-border pt-6">
        {!success ? (
          <>
            <p className="text-center text-sm text-muted-foreground">
              Already registered?{" "}
              <Link
                href="/login"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            </p>
            <Link
              href="/"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "inline-flex w-full items-center justify-center",
              )}
            >
              Back to home
            </Link>
          </>
        ) : null}
      </CardFooter>
    </Card>
  );
}
