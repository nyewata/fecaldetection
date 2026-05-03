"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Bug, ClipboardList, Layers, Microscope } from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

type DashboardStats = {
  totalPredictions: number;
  fecalDetectedStage1: number;
  helminthPositivePhase2: number;
};

type DashboardLiveStatsProps = {
  initialStats: DashboardStats;
  predictionApiDelegateToken: string | null;
};

export function DashboardLiveStats({
  initialStats,
  predictionApiDelegateToken,
}: DashboardLiveStatsProps) {
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const headers = useMemo(
    () =>
      predictionApiDelegateToken
        ? { Authorization: `Bearer ${predictionApiDelegateToken}` }
        : undefined,
    [predictionApiDelegateToken],
  );

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch("/api/predictions/pipeline-run/stats", {
        credentials: "include",
        headers,
      });
      const data = (await res.json()) as { stats?: DashboardStats };
      if (res.ok && data.stats) {
        setStats(data.stats);
      }
    } catch {
      /* keep last visible stats */
    }
  }, [headers]);

  useEffect(() => {
    setStats(initialStats);
  }, [initialStats]);

  useEffect(() => {
    void refreshStats();
    const onSaved = () => {
      void refreshStats();
    };
    window.addEventListener("pipeline-run-saved", onSaved);
    return () => {
      window.removeEventListener("pipeline-run-saved", onSaved);
    };
  }, [refreshStats]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={ClipboardList}
        label="Total predictions"
        value={String(stats.totalPredictions)}
        hint="All-time finished pipeline runs"
        accent="text-chart-5 dark:text-chart-1"
        accentBg="bg-chart-1 dark:bg-chart-5/25"
      />
      <StatCard
        icon={Microscope}
        label="Fecal detected"
        value={String(stats.fecalDetectedStage1)}
        hint="All-time Stage 1 result = Fecal"
        accent="text-primary dark:text-primary-foreground"
        accentBg="bg-primary/12 dark:bg-primary/30"
      />
      <StatCard
        icon={Layers}
        label="Helminths found"
        value={String(stats.helminthPositivePhase2)}
        hint="All-time Stage 2 result = Helminths"
        accent="text-chart-4 dark:text-chart-2"
        accentBg="bg-chart-2/40 dark:bg-chart-4/35"
      />
      <StatCard
        icon={Bug}
        label="Species identified"
        value="—"
        hint="Phase 3 not connected yet"
        accent="text-chart-3 dark:text-chart-1"
        accentBg="bg-chart-2/25 dark:bg-chart-3/30"
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
  accentBg,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
  accent?: string;
  accentBg?: string;
}) {
  return (
    <Card className="border-border/80 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <div
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            accentBg ?? "bg-muted",
          )}
        >
          <Icon className={cn("size-4", accent ?? "text-muted-foreground")} />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
