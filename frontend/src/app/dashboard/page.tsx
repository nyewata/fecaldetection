import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { auth } from "@/lib/auth/server";
import { cn } from "@/lib/utils";
import {
  Activity,
  FlaskConical,
  ImagePlus,
  Layers,
  Microscope,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Clinician workspace for fecal microscopy classification.",
};

export default async function DashboardPage() {
  const { data: session } = await auth.getSession();
  const user = session?.user;

  return (
    <main className="flex-1 bg-muted/10">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* Page header */}
        <div className="pb-8">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <Activity className="size-3.5" aria-hidden />
                Clinician workspace
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Welcome back{user?.name ? `, ${user.name}` : ""}
              </h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Upload microscopy slides, run staged fecal screening and binary
            classification, and review model-assisted findings — all in one
            place.
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Microscope}
            label="Cases queued"
            value="0"
            hint="Awaiting inference"
            accent="text-blue-600 dark:text-blue-400"
          />
          <StatCard
            icon={ShieldCheck}
            label="Reviewed today"
            value="0"
            hint="Manual confirmations"
            accent="text-emerald-600 dark:text-emerald-400"
          />
          <StatCard
            icon={Layers}
            label="Active models"
            value="2"
            hint="Binary + multi-class"
            accent="text-violet-600 dark:text-violet-400"
          />
          <StatCard
            icon={FlaskConical}
            label="Last batch"
            value="—"
            hint="No batches yet"
            accent="text-amber-600 dark:text-amber-400"
          />
        </div>

        {/* Main content grid */}
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {/* Upload card */}
          <Card className="border-border/80 lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ImagePlus className="size-5 text-muted-foreground" />
                Upload &amp; predict
              </CardTitle>
              <CardDescription>
                Drag-and-drop microscopy tiles to start the staged pipeline.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="group flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-border bg-muted/20 px-6 py-14 text-center transition-colors hover:border-primary/40 hover:bg-muted/30">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                  <Upload className="size-7" aria-hidden />
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    Drop slide images here
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    PNG, JPG, or TIFF up to 50 MB each
                  </p>
                </div>
                <Button className="mt-2 h-9" type="button" disabled>
                  Browse files (coming soon)
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Workflow sidebar */}
          <Card className="border-border/80">
            <CardHeader>
              <CardTitle className="text-lg">Workflow stages</CardTitle>
              <CardDescription>
                Your prediction pipeline at a glance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-sm">
                {[
                  { label: "Screen: fecal / non-fecal detection", done: false },
                  { label: "Binary review: confirm positive fields", done: false },
                  { label: "Multi-class overlay: subclass labels", done: false },
                  { label: "Export: audit log + clinician sign-off", done: false },
                ].map((step, i) => (
                  <li
                    key={step.label}
                    className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2.5 transition-colors hover:bg-muted/30"
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        step.done
                          ? "bg-emerald-600 text-white"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="text-foreground/90">{step.label}</span>
                  </li>
                ))}
              </ol>
              <Link
                href="/#workflow"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "mt-6 inline-flex w-full items-center justify-center",
                )}
              >
                View pipeline details
              </Link>
            </CardContent>
          </Card>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Signed in as{" "}
          <span className="font-mono text-foreground/80">{user?.email}</span>
        </p>
      </div>
    </main>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  accent?: string;
}) {
  return (
    <Card className="border-border/80 transition-shadow duration-200 hover:shadow-md">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className={cn("size-4", accent ?? "text-muted-foreground")} />
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
