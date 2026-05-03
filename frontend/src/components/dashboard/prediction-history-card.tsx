"use client";

import { DetectionImagePreview } from "@/components/dashboard/detection-image-preview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDetectionPaletteEntryForClass } from "@/lib/detection-palette";
import type { PredictionPipelineRunRow } from "@/lib/pipeline-db";
import { buildDetectionOverlayItemsFromResults } from "@/lib/stage3-detection-overlay";
import { cn } from "@/lib/utils";
import { Copy, Download, ImagePlus, Loader2, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const HISTORY_PAGE_SIZE = 30;
const HISTORY_VISIBLE_STEP = 10;

const selectClass =
  "h-8 min-w-[9.5rem] rounded-md border border-input bg-background px-2 text-xs shadow-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-sm";

type PredictionHistoryCardProps = {
  initialHistory: PredictionPipelineRunRow[];
  predictionApiDelegateToken: string | null;
};

type OutcomeFilter =
  | "all"
  | "finished"
  | "failed"
  | "non_fecal"
  | "helminth_positive"
  | "helminth_negative"
  | "stage3_finished";

type DateFilter = "all" | "today" | "7d" | "30d";

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
    const stage3Tail =
      row.stage3_status === "finished"
        ? " Stage 3 species localization complete."
        : row.stage3_status === "skipped" && vote?.majorityClass === 1
          ? " Stage 3 skipped (no helminths)."
          : "";
    return `Stage 2 result: ${label} (${vote?.positiveVotes ?? 0} helminths votes / ${vote?.negativeVotes ?? 0} non-helminths votes).${stage3Tail}`;
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

function shortModelName(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  return base.replace(/\.(keras|h5|pb|onnx|tflite|savedmodel)$/i, "");
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function rowMatchesOutcome(row: PredictionPipelineRunRow, f: OutcomeFilter): boolean {
  if (f === "all") return true;
  if (f === "finished") return row.status === "finished";
  if (f === "failed") return row.status === "failed";
  if (f === "non_fecal") return row.final_outcome === "non_fecal";
  if (f === "helminth_positive") return row.final_outcome === "helminth_positive";
  if (f === "helminth_negative") return row.final_outcome === "helminth_negative";
  if (f === "stage3_finished") return row.stage3_status === "finished";
  return true;
}

function rowMatchesDate(row: PredictionPipelineRunRow, f: DateFilter): boolean {
  if (f === "all") return true;
  const created = new Date(row.created_at).getTime();
  const now = Date.now();
  if (f === "today") return created >= startOfTodayMs();
  if (f === "7d") return created >= now - 7 * 86400000;
  if (f === "30d") return created >= now - 30 * 86400000;
  return true;
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
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [detailRun, setDetailRun] = useState<PredictionPipelineRunRow | null>(null);
  const [detailModalImageLoaded, setDetailModalImageLoaded] = useState(false);
  const [annotatedDownloadBusy, setAnnotatedDownloadBusy] = useState(false);

  const filteredHistory = useMemo(
    () =>
      history.filter(
        (row) => rowMatchesOutcome(row, outcomeFilter) && rowMatchesDate(row, dateFilter),
      ),
    [history, outcomeFilter, dateFilter],
  );

  const detailOverlayItems = useMemo(() => {
    if (!detailRun?.stage3_result_payload || typeof detailRun.stage3_result_payload !== "object") {
      return [];
    }
    const results = (detailRun.stage3_result_payload as { results?: unknown }).results;
    return buildDetectionOverlayItemsFromResults(results);
  }, [detailRun]);

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

  useEffect(() => {
    setHistoryVisibleCount((prev) =>
      Math.min(Math.max(HISTORY_VISIBLE_STEP, prev), Math.max(filteredHistory.length, 1)),
    );
  }, [outcomeFilter, dateFilter, filteredHistory.length]);

  useEffect(() => {
    if (!detailRun?.id) return;
    setDetailModalImageLoaded(false);
  }, [detailRun?.id]);

  useEffect(() => {
    if (!detailRun) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailRun(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [detailRun]);

  const visibleHistory = filteredHistory.slice(0, historyVisibleCount);
  const canLoadMoreHistory =
    historyVisibleCount < filteredHistory.length ||
    (historyHasMore && historyVisibleCount >= filteredHistory.length);

  const handleLoadMoreHistory = async () => {
    if (historyVisibleCount < filteredHistory.length) {
      setHistoryVisibleCount((prev) => prev + HISTORY_VISIBLE_STEP);
      return;
    }
    if (historyHasMore && !historyLoading) {
      await loadHistory({ append: true });
    }
  };

  const copyRunId = useCallback(async () => {
    if (!detailRun) return;
    try {
      await navigator.clipboard.writeText(detailRun.id);
      toast.success("Run ID copied", {
        description: "Paste it into support or lab logs when asked for the run reference.",
      });
    } catch {
      toast.error("Could not copy", {
        description: "Your browser may block clipboard access on this page.",
      });
    }
  }, [detailRun]);

  const downloadAnnotatedPng = useCallback(async () => {
    if (!detailRun?.stage3_annotated_image_object_key) return;
    const url = `/api/predictions/pipeline-run/${detailRun.id}/image/stage3-annotated`;
    setAnnotatedDownloadBusy(true);
    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: delegateAuthHeaders,
      });
      if (!res.ok) {
        toast.error("Download failed", { description: `Server returned ${res.status}.` });
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const base = (detailRun.original_filename ?? "prediction").replace(/\.[^/.]+$/, "");
      const filename = `${base}-stage3-annotated.png`;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success("Download started", { description: filename });
    } catch {
      toast.error("Download failed", { description: "Network error while fetching the image." });
    } finally {
      setAnnotatedDownloadBusy(false);
    }
  }, [detailRun, delegateAuthHeaders]);

  return (
    <Card className="border-border/80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ImagePlus className="size-5 text-muted-foreground" aria-hidden />
          Prediction history
        </CardTitle>
        <CardDescription>
          Filter by outcome or date, then tap a row for details, download, and run ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Outcome
              <select
                className={selectClass}
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)}
              >
                <option value="all">All outcomes</option>
                <option value="finished">Finished</option>
                <option value="failed">Failed</option>
                <option value="non_fecal">Non-fecal (Stage 1)</option>
                <option value="helminth_positive">Helminth-positive</option>
                <option value="helminth_negative">Helminth-negative</option>
                <option value="stage3_finished">Stage 3 complete</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Date
              <select
                className={selectClass}
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              >
                <option value="all">Any time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </label>
          </div>
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
        ) : filteredHistory.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No runs match these filters. Try &ldquo;All outcomes&rdquo; or a wider date range.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {visibleHistory.map((row) => {
                const thumbSrc = row.stage3_annotated_image_object_key
                  ? `/api/predictions/pipeline-run/${row.id}/image/stage3-annotated`
                  : row.image_object_key
                    ? `/api/predictions/pipeline-run/${row.id}/image`
                    : null;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setDetailRun(row)}
                      className={cn(
                        "w-full rounded-lg border border-border/60 bg-background/80 px-3 py-3 text-left text-sm transition-colors",
                        "hover:border-primary/35 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        {thumbSrc ? (
                          <Image
                            src={thumbSrc}
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
                              S1 {row.stage1_status} · S2 {row.stage2_status} · S3{" "}
                              {row.stage3_status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(row.created_at).toLocaleString()} · {row.status}
                            {row.final_outcome ? ` · ${row.final_outcome}` : ""}
                          </p>
                          <p className="mt-2 text-xs leading-relaxed text-foreground/90">
                            {summarizePipelineRun(row)}
                          </p>
                          <p className="mt-1.5 text-[10px] font-medium text-primary">
                            View details
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
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

      {detailRun ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
          <button
            type="button"
            className="fixed inset-0 bg-black/55 backdrop-blur-[1px]"
            aria-label="Close details"
            onClick={() => setDetailRun(null)}
          />
          <div
            className="relative z-10 mt-0 w-full max-w-3xl rounded-xl border border-border/80 bg-background shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pipeline-detail-title"
          >
            <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
              <div className="min-w-0 flex-1">
                <h2
                  id="pipeline-detail-title"
                  className="truncate text-base font-semibold text-foreground"
                >
                  {detailRun.original_filename ?? "Run details"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {new Date(detailRun.created_at).toLocaleString()} · {detailRun.status}
                  {detailRun.final_outcome ? ` · ${detailRun.final_outcome}` : ""}
                </p>
                <p
                  className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground"
                  title={detailRun.id}
                >
                  Run ID: {detailRun.id}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void copyRunId()}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    Copy run ID
                  </Button>
                  {detailRun.stage3_annotated_image_object_key ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={annotatedDownloadBusy}
                      onClick={() => void downloadAnnotatedPng()}
                    >
                      {annotatedDownloadBusy ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Download className="size-3.5" aria-hidden />
                      )}
                      Annotated PNG
                    </Button>
                  ) : null}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 self-start"
                onClick={() => setDetailRun(null)}
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="max-h-[calc(100vh-8rem)] space-y-5 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2 text-xs">
                  <p className="font-semibold text-foreground">Stage 1</p>
                  <p className="mt-1 text-muted-foreground">
                    {detailRun.stage1_vote_summary
                      ? (() => {
                          const v = detailRun.stage1_vote_summary as {
                            majorityClass?: number;
                            positiveVotes?: number;
                            negativeVotes?: number;
                          };
                          const lab =
                            v.majorityClass === 0
                              ? "Fecal"
                              : v.majorityClass === 1
                                ? "Non-fecal"
                                : "—";
                          return `${lab} · votes ${v.positiveVotes ?? 0} / ${v.negativeVotes ?? 0}`;
                        })()
                      : detailRun.stage1_status}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2 text-xs">
                  <p className="font-semibold text-foreground">Stage 2</p>
                  <p className="mt-1 text-muted-foreground">
                    {detailRun.stage2_vote_summary
                      ? (() => {
                          const v = detailRun.stage2_vote_summary as {
                            majorityClass?: number;
                            positiveVotes?: number;
                            negativeVotes?: number;
                          };
                          const lab =
                            v.majorityClass === 0
                              ? "Helminths"
                              : v.majorityClass === 1
                                ? "No helminths"
                                : "—";
                          return `${lab} · votes ${v.positiveVotes ?? 0} / ${v.negativeVotes ?? 0}`;
                        })()
                      : detailRun.stage2_status}
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2 text-xs">
                  <p className="font-semibold text-foreground">Stage 3</p>
                  <p className="mt-1 text-muted-foreground">
                    {detailRun.stage3_status === "finished"
                      ? `${detailOverlayItems.length} detection(s)`
                      : detailRun.stage3_status}
                  </p>
                </div>
              </div>

              {detailRun.stage3_annotated_image_object_key ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Species localization (saved image)
                  </p>
                  <div className="relative w-full min-h-[min(40vh,320px)]">
                    {!detailModalImageLoaded ? (
                      <Skeleton className="absolute inset-0 z-0 h-full min-h-[min(40vh,320px)] w-full rounded-lg" />
                    ) : null}
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API URL */}
                    <img
                      src={`/api/predictions/pipeline-run/${detailRun.id}/image/stage3-annotated`}
                      alt="Stage 3 annotated slide"
                      className={cn(
                        "relative z-10 mx-auto block h-auto max-h-[min(70vh,560px)] w-full rounded-lg border border-border/60 object-contain",
                        !detailModalImageLoaded && "opacity-0",
                      )}
                      onLoad={() => setDetailModalImageLoaded(true)}
                    />
                  </div>
                </div>
              ) : detailRun.image_object_key && detailOverlayItems.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Species localization (from stored results)
                  </p>
                  <div className="relative w-full min-h-[min(40vh,320px)]">
                    {!detailModalImageLoaded ? (
                      <Skeleton className="absolute inset-0 z-0 h-full min-h-[min(40vh,320px)] w-full rounded-lg" />
                    ) : null}
                    <div className={cn(!detailModalImageLoaded && "opacity-0")}>
                      <DetectionImagePreview
                        objectUrl={`/api/predictions/pipeline-run/${detailRun.id}/image`}
                        items={detailOverlayItems}
                        onImageLoad={() => setDetailModalImageLoaded(true)}
                      />
                    </div>
                  </div>
                </div>
              ) : detailRun.image_object_key ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Original upload
                  </p>
                  <div className="relative w-full min-h-[min(40vh,320px)]">
                    {!detailModalImageLoaded ? (
                      <Skeleton className="absolute inset-0 z-0 h-full min-h-[min(40vh,320px)] w-full rounded-lg" />
                    ) : null}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/predictions/pipeline-run/${detailRun.id}/image`}
                      alt="Uploaded slide"
                      className={cn(
                        "relative z-10 mx-auto block h-auto max-h-[min(70vh,560px)] w-full rounded-lg border border-border/60 object-contain",
                        !detailModalImageLoaded && "opacity-0",
                      )}
                      onLoad={() => setDetailModalImageLoaded(true)}
                    />
                  </div>
                </div>
              ) : null}

              {detailOverlayItems.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Detection legend
                  </p>
                  <ul className="space-y-1.5 text-sm">
                    {detailOverlayItems.map((d) => {
                      const col = getDetectionPaletteEntryForClass(d.classId, d.className);
                      return (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-muted/15 px-2 py-1.5"
                        >
                          <span
                            className="flex size-7 shrink-0 items-center justify-center rounded border-2 font-mono text-xs font-bold text-white"
                            style={{
                              borderColor: col.border,
                              backgroundColor: col.badge,
                            }}
                          >
                            {d.legendKey}
                          </span>
                          <span className="min-w-0 flex-1 font-medium text-foreground">
                            {d.className}
                          </span>
                          <span className="text-muted-foreground">
                            {(d.confidence <= 1
                              ? (d.confidence * 100).toFixed(1)
                              : d.confidence.toFixed(1))}
                            % · {shortModelName(d.modelFilename)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <p className="text-xs leading-relaxed text-muted-foreground">
                {summarizePipelineRun(detailRun)}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
