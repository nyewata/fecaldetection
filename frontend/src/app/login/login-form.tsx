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
import { cn } from "@/lib/utils";
import { Microscope } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { signInWithEmail, type AuthFormState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<
    AuthFormState,
    FormData
  >(signInWithEmail, null);

  return (
    <Card className="w-full max-w-md border-border/80 shadow-sm">
      <CardHeader className="items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted/50">
          <Microscope className="size-6 text-foreground/70" aria-hidden />
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          Welcome back
        </CardTitle>
        <CardDescription className="text-balance">
          Sign in to open your clinician dashboard and prediction workflow.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form className="space-y-4" action={formAction}>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@hospital.org"
              className="h-9"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="h-9"
              required
            />
          </div>
          {state?.error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" className="h-9 w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col gap-4 border-t border-border pt-6">
        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link
            href="/register"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Register
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
      </CardFooter>
    </Card>
  );
}
