"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PredictionPipelineRunRow } from "@/lib/pipeline-db";
import { ImagePlus } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

const HISTORY_PAGE_SIZE = 30;
const HISTORY_VISIBLE_STEP = 10;

type PredictionHistoryCardProps = {
  initialHistory: PredictionPipelineRunRow[];
  predictionApiDelegateToken: string | null;
};

function summarizePipelineRun(row: PredictionPipelineRunRow): string {
  if (row.status === "failed") return row.error_message || "Failed";
  if (row.stage2_status === "skipped") {
    const vote = row.stage1_vote_summary as
      | { positiveVotes?: number; negativeVotes?: number }
      | null;
    return `Stage 1 result: Non-fecal (${vote?.positiveVotes ?? 0} fecal votes / ${vote?.negativeVotes ?? 0} non-fecal votes). Stage 2 skipped.`;
  }
  if (row.stage2_vote_summary) {
    const vote = row.stage2_vote_summary as
      | { positiveVotes?: number; negativeVotes?: number; majorityClass?: number }
      | null;
    const label =
      vote?.majorityClass === 0
        ? "Helminths detected"
        : vote?.majorityClass === 1
          ? "No helminths"
          : "Unknown";
    return `Stage 2 result: ${label} (${vote?.positiveVotes ?? 0} helminths votes / ${vote?.negativeVotes ?? 0} non-helminths votes).`;
  }
  if (row.stage1_vote_summary) {
    const vote = row.stage1_vote_summary as
      | { majorityClass?: number; positiveVotes?: number; negativeVotes?: number }
      | null;
    const label =
      vote?.majorityClass === 0
        ? "Fecal"
        : vote?.majorityClass === 1
          ? "Non-fecal"
          : "Unknown";
    return `Stage 1 result: ${label} (${vote?.positiveVotes ?? 0} fecal votes / ${vote?.negativeVotes ?? 0} non-fecal votes).`;
  }
  return row.status;
}

export function PredictionHistoryCard({
  initialHistory,
  predictionApiDelegateToken,
}: PredictionHistoryCardProps) {
  const delegateAuthHeaders = useMemo(
    () =>
      predictionApiDelegateToken
        ? { Authorization: `Bearer ${predictionApiDelegateToken}` }
        : undefined,
    [predictionApiDelegateToken],
  );
  const [history, setHistory] = useState<PredictionPipelineRunRow[]>(initialHistory);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(
    Math.min(HISTORY_VISIBLE_STEP, initialHistory.length),
  );
  const [historyOffset, setHistoryOffset] = useState(initialHistory.length);
  const [historyHasMore, setHistoryHasMore] = useState(
    initialHistory.length >= HISTORY_PAGE_SIZE,
  );

  const loadHistory = useCallback(
    async (opts?: { append?: boolean }) => {
      const append = opts?.append ?? false;
      setHistoryLoading(true);
      try {
        const offset = append ? historyOffset : 0;
        const res = await fetch(
          `/api/predictions/pipeline-run/history?limit=${HISTORY_PAGE_SIZE}&offset=${offset}`,
          {
            credentials: "include",
            headers: delegateAuthHeaders,
          },
        );
        const data = (await res.json()) as {
          items?: PredictionPipelineRunRow[];
        };
        if (!res.ok || !data.items) return;
        const items = data.items;

        if (append) {
          setHistory((prev) => [...prev, ...items]);
          setHistoryOffset((prev) => prev + items.length);
          setHistoryHasMore(items.length >= HISTORY_PAGE_SIZE);
          setHistoryVisibleCount((prev) => prev + HISTORY_VISIBLE_STEP);
          return;
        }

        setHistory(items);
        setHistoryOffset(items.length);
        setHistoryHasMore(items.length >= HISTORY_PAGE_SIZE);
        setHistoryVisibleCount(Math.min(HISTORY_VISIBLE_STEP, items.length));
      } finally {
        setHistoryLoading(false);
      }
    },
    [delegateAuthHeaders, historyOffset],
  );

  useEffect(() => {
    setHistory(initialHistory);
    setHistoryOffset(initialHistory.length);
    setHistoryHasMore(initialHistory.length >= HISTORY_PAGE_SIZE);
    setHistoryVisibleCount(Math.min(HISTORY_VISIBLE_STEP, initialHistory.length));
  }, [initialHistory]);

  useEffect(() => {
    const onSaved = () => {
      void loadHistory();
    };
    window.addEventListener("pipeline-run-saved", onSaved);
    return () => {
      window.removeEventListener("pipeline-run-saved", onSaved);
    };
  }, [loadHistory]);

  const visibleHistory = history.slice(0, historyVisibleCount);
  const canLoadMoreHistory = historyVisibleCount < history.length || historyHasMore;

  const handleLoadMoreHistory = async () => {
    if (historyVisibleCount < history.length) {
      setHistoryVisibleCount((prev) => prev + HISTORY_VISIBLE_STEP);
      return;
    }
    if (historyHasMore && !historyLoading) {
      await loadHistory({ append: true });
    }
  };

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
          Prediction history
        </CardTitle>
        <CardDescription>
          Shows the latest 10 runs first. Load more when needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={historyLoading}
            onClick={() => void loadHistory()}
          >
            Refresh
          </Button>
        </div>
        {historyLoading && history.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : history.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No saved runs yet. Complete a screening to see it here.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {visibleHistory.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-border/60 bg-background/80 px-3 py-3 text-sm"
                >
                  <div className="flex items-start gap-3">
                    {row.image_object_key ? (
                      <Image
                        src={`/api/predictions/pipeline-run/${row.id}/image`}
                        alt={row.original_filename ?? "Prediction image"}
                        width={64}
                        height={64}
                        className="h-16 w-16 shrink-0 rounded-md border border-border/70 object-cover"
                        loading="lazy"
                        unoptimized
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          {row.original_filename ?? "Untitled"}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          S1 {row.stage1_status} · S2 {row.stage2_status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(row.created_at).toLocaleString()} · {row.status}
                        {row.final_outcome ? ` · ${row.final_outcome}` : ""}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-foreground/90">
                        {summarizePipelineRun(row)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {canLoadMoreHistory ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={historyLoading}
                onClick={() => void handleLoadMoreHistory()}
                className="w-full"
              >
                {historyLoading ? "Loading..." : "Load 10 more"}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
