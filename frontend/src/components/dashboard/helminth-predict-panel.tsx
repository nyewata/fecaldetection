"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PipelineStepper } from "@/components/pipeline-stepper";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Loader2,
  Radio,
  Upload,
} from "lucide-react";

type StepStatus = "idle" | "active" | "complete" | "skipped";
type StageNumber = 1 | 2;

type PipelineStatusPayload = {
  ok: true;
  runStatus: "processing" | "finished" | "failed" | "timed_out";
  stage: StageNumber | null;
  persisted: boolean;
  remote?: Record<string, unknown>;
  gateDecision?: "fecal" | "non_fecal";
  awaitingStage2Start?: boolean;
  idempotent?: boolean;
};

type PipelineSubmitResponse = {
  id: string;
  stage: {
    stage: StageNumber;
    externalJobId: string;
    totalModels: number;
  };
};

type Stage2StartResponse = {
  ok: true;
  stage: {
    stage: 2;
    externalJobId: string;
    totalModels: number;
  };
  idempotent?: boolean;
};

type WsPayload = {
  type?: string;
  job_id?: string;
  status?: string;
  total_models?: number;
  completed_models?: number;
  results?: unknown[];
  errors?: unknown[];
  data?: {
    modelFilename?: string;
    classification?: {
      predicted_class?: number;
      max_prob?: number;
      probability?: number;
      class_probabilities?: Record<string, number>;
    };
    index?: number;
    error?: string;
  };
  progress?: { completed?: number; total?: number };
};

type StageVoteSummary = {
  totalModels: number;
  positiveVotes: number;
  negativeVotes: number;
  majorityClass: 0 | 1;
};

type ActivityItem = {
  id: string;
  stage: StageNumber;
  modelFilename: string;
  predictedClass: number | null;
  confidencePct: number | null;
  error: string | null;
};

export type HelminthPredictPanelProps = {
  predictionApiDelegateToken: string | null;
};

function wsOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_HELMINTH_WS_ORIGIN?.replace(/\/$/, "") ||
    "wss://binaryapi.helminthdetect.app"
  );
}

function wsUrl(jobId: string): string {
  return `${wsOrigin()}/ws/${jobId}`;
}

function shortModelName(filename: string): string {
  return filename
    .replace(/\.keras$/i, "")
    .replace(/^HELMINTHS_BINARY_/i, "")
    .replace(/^BINARY_/i, "");
}

function classLabel(stage: StageNumber, predictedClass: number | null): string {
  if (predictedClass === null) return "Unknown";
  if (stage === 1) {
    return predictedClass === 0 ? "Fecal" : "Non-fecal";
  }
  return predictedClass === 0 ? "Helminths detected" : "No helminths";
}

function toConfidencePercent(
  classification: {
    predicted_class?: number;
    max_prob?: number;
    probability?: number;
    class_probabilities?: Record<string, number>;
  } | undefined,
): number | null {
  if (!classification) return null;
  const predictedClass =
    classification.predicted_class === 0 || classification.predicted_class === 1
      ? classification.predicted_class
      : null;
  if (
    predictedClass !== null &&
    classification.class_probabilities &&
    typeof classification.class_probabilities[String(predictedClass)] === "number"
  ) {
    const value = classification.class_probabilities[String(predictedClass)]!;
    return value <= 1 ? value * 100 : value;
  }
  if (typeof classification.max_prob === "number") {
    return classification.max_prob <= 1
      ? classification.max_prob * 100
      : classification.max_prob;
  }
  return null;
}

function buildVoteSummaryFromResults(results: unknown[]): StageVoteSummary {
  let positiveVotes = 0;
  let negativeVotes = 0;
  for (const row of results) {
    const cls = (row as { classification?: { predicted_class?: unknown } })
      .classification?.predicted_class;
    if (cls === 0) positiveVotes += 1;
    if (cls === 1) negativeVotes += 1;
  }
  return {
    totalModels: results.length,
    positiveVotes,
    negativeVotes,
    majorityClass: positiveVotes > negativeVotes ? 0 : 1,
  };
}

export function HelminthPredictPanel({
  predictionApiDelegateToken,
}: HelminthPredictPanelProps) {
  const delegateAuthHeaders = useMemo(
    () =>
      predictionApiDelegateToken
        ? { Authorization: `Bearer ${predictionApiDelegateToken}` }
        : undefined,
    [predictionApiDelegateToken],
  );

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [preview, setPreview] = useState<{ results: unknown[]; errors: unknown[] } | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [stage1Status, setStage1Status] = useState<StepStatus>("idle");
  const [stage2Status, setStage2Status] = useState<StepStatus>("idle");
  const [stage1Vote, setStage1Vote] = useState<StageVoteSummary | null>(null);
  const [stage2Vote, setStage2Vote] = useState<StageVoteSummary | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runIdRef = useRef<string | null>(null);
  const currentStageRef = useRef<StageNumber | null>(null);
  const stage2StartedRef = useRef(false);
  const fileRef = useRef<File | null>(null);

  const stepperStatuses: { status: StepStatus }[] = useMemo(
    () => [{ status: stage1Status }, { status: stage2Status }, { status: "skipped" }],
    [stage1Status, stage2Status],
  );

  const isRunning = stage1Status === "active" || stage2Status === "active";
  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  const clearTimers = useCallback(() => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
    if (fallbackRef.current) {
      clearInterval(fallbackRef.current);
      fallbackRef.current = null;
    }
  }, []);

  const teardownWs = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [clearTimers]);

  const finishPipeline = useCallback(
    async (message: string) => {
      setLiveMessage(message);
      setStage1Status((prev) => (prev === "active" ? "complete" : prev));
      if (stage2Status === "active") {
        setStage2Status("complete");
      }
      setProgress((prev) => ({ ...prev, done: prev.total }));
      window.dispatchEvent(new Event("pipeline-run-saved"));
    },
    [stage2Status],
  );

  const applyWsPayload = useCallback((msg: WsPayload, stage: StageNumber) => {
    if (msg.type === "connected" && Array.isArray(msg.results)) {
      setPreview({ results: msg.results, errors: (msg.errors as unknown[]) ?? [] });
    }
    if (typeof msg.total_models === "number") {
      setProgress((prev) => ({ ...prev, total: msg.total_models ?? prev.total }));
    }
    if (typeof msg.completed_models === "number") {
      setProgress((prev) => ({ ...prev, done: msg.completed_models ?? prev.done }));
    }
    if (msg.type === "prediction" && msg.data) {
      const row = msg.data;
      setPreview((prev) => {
        const next = { ...(prev ?? { results: [], errors: [] }) };
        next.results = [...(next.results as object[]), row as object];
        return next;
      });
      setActivity((prev) => [
        {
          id: `${Date.now()}-${Math.random()}`,
          stage,
          modelFilename: String(row.modelFilename ?? "model"),
          predictedClass:
            typeof row.classification?.predicted_class === "number"
              ? row.classification.predicted_class
              : null,
          confidencePct: toConfidencePercent(row.classification),
          error: null,
        },
        ...prev,
      ]);
      setProgress((prev) => ({
        total: msg.progress?.total ?? prev.total,
        done: msg.progress?.completed ?? prev.done,
      }));
    }
    if (msg.type === "model_error" && msg.data) {
      const row = msg.data;
      setPreview((prev) => {
        const next = { ...(prev ?? { results: [], errors: [] }) };
        next.errors = [...(next.errors as object[]), row as object];
        return next;
      });
      setActivity((prev) => [
        {
          id: `${Date.now()}-${Math.random()}`,
          stage,
          modelFilename: String(row.modelFilename ?? "model"),
          predictedClass: null,
          confidencePct: null,
          error: String(row.error ?? "Error"),
        },
        ...prev,
      ]);
    }
    if (msg.type === "finished") {
      const results = (msg.results as unknown[]) ?? [];
      const errors = (msg.errors as unknown[]) ?? [];
      setPreview({ results, errors });
      if (typeof msg.completed_models === "number") {
        setProgress({ done: msg.completed_models, total: msg.total_models ?? results.length });
      }
      if (stage === 1) {
        setStage1Vote(buildVoteSummaryFromResults(results));
      } else {
        setStage2Vote(buildVoteSummaryFromResults(results));
      }
    }
  }, []);

  const startStage2 = useCallback(
    async (runId: string) => {
      if (stage2StartedRef.current) return;
      stage2StartedRef.current = true;

      const originalFile = fileRef.current;
      if (!originalFile) {
        throw new Error(
          "Stage 2 requires the original image in this session. Re-run pipeline upload.",
        );
      }

      setStage2Status("active");
      setProgress({ done: 0, total: 0 });
      setLiveMessage("Stage 1 is fecal-positive. Starting Stage 2 helminth screening…");

      const fd = new FormData();
      fd.set("image", originalFile);
      const res = await fetch(
        `/api/predictions/pipeline-run/${encodeURIComponent(runId)}/stage2`,
        {
          method: "POST",
          body: fd,
          credentials: "include",
          headers: delegateAuthHeaders,
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        stage?: { externalJobId?: string; totalModels?: number };
      };
      if (!res.ok || !data.ok || !data.stage?.externalJobId) {
        stage2StartedRef.current = false;
        throw new Error(data.error || "Could not start Stage 2.");
      }

      currentStageRef.current = 2;
      setProgress({ done: 0, total: data.stage.totalModels ?? 0 });
      setLiveMessage("Stage 2 started. Opening live connection…");
      const ws = new WebSocket(wsUrl(data.stage.externalJobId));
      wsRef.current = ws;
      ws.onopen = () => {
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 15000);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data)) as WsPayload;
          applyWsPayload(msg, 2);
          if (msg.type === "finished" || msg.status === "finished") {
            teardownWs();
            void (async () => {
              const fr = await fetch(
                `/api/predictions/pipeline-run/${encodeURIComponent(runId)}/finalize`,
                {
                  method: "PATCH",
                  credentials: "include",
                  headers: delegateAuthHeaders,
                },
              );
              const fin = (await fr.json()) as PipelineStatusPayload & { error?: string };
              if (!fr.ok || !fin.ok) {
                throw new Error(fin.error || "Finalize failed.");
              }
              setStage2Status("complete");
              await finishPipeline("Pipeline complete. Results saved.");
            })().catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : "Finalize failed.");
              setStage2Status("idle");
            });
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onerror = () => {
        setLiveMessage("WebSocket unavailable — syncing over HTTPS.");
      };
    },
    [applyWsPayload, delegateAuthHeaders, finishPipeline, teardownWs],
  );

  const handleStatusResult = useCallback(
    async (runId: string, result: PipelineStatusPayload) => {
      if (result.stage && result.remote) {
        applyWsPayload(result.remote as unknown as WsPayload, result.stage);
      }

      if (result.stage === 1 && result.persisted) {
        setStage1Status("complete");
      }
      if (result.gateDecision === "non_fecal") {
        setStage2Status("skipped");
        await finishPipeline(
          "Stage 1 majority vote is non-fecal. Stage 2 skipped and run saved.",
        );
        return;
      }
      if (result.awaitingStage2Start) {
        setStage2Status("idle");
        await startStage2(runId);
        return;
      }
      if (
        result.runStatus === "finished" &&
        (result.stage === 2 || result.stage === null)
      ) {
        setStage2Status("complete");
        await finishPipeline("Pipeline complete. Results saved.");
      }
    },
    [applyWsPayload, finishPipeline, startStage2],
  );

  const startFallbackSync = useCallback(
    (runId: string) => {
      if (fallbackRef.current) return;
      fallbackRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `/api/predictions/pipeline-run/${encodeURIComponent(runId)}/sync`,
            { credentials: "include", headers: delegateAuthHeaders },
          );
          const data = (await res.json()) as PipelineStatusPayload & { error?: string };
          if (!res.ok || !data.ok) return;
          await handleStatusResult(runId, data);
          if (data.runStatus === "finished" || data.runStatus === "failed") {
            clearInterval(fallbackRef.current!);
            fallbackRef.current = null;
          }
        } catch {
          /* keep polling */
        }
      }, 2000);
    },
    [delegateAuthHeaders, handleStatusResult],
  );

  const connectWebSocket = useCallback(
    (externalJobId: string, runId: string, stage: StageNumber) => {
      teardownWs();
      currentStageRef.current = stage;
      setLiveMessage(
        stage === 1
          ? "Stage 1 started. Opening live connection…"
          : "Stage 2 started. Opening live connection…",
      );
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl(externalJobId));
      } catch {
        setLiveMessage("WebSocket unavailable — syncing over HTTPS.");
        startFallbackSync(runId);
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 15000);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data)) as WsPayload;
          applyWsPayload(msg, stage);
          if (msg.type === "finished" || msg.status === "finished") {
            teardownWs();
            void (async () => {
              const res = await fetch(
                `/api/predictions/pipeline-run/${encodeURIComponent(runId)}/finalize`,
                {
                  method: "PATCH",
                  credentials: "include",
                  headers: delegateAuthHeaders,
                },
              );
              const data = (await res.json()) as PipelineStatusPayload & { error?: string };
              if (!res.ok || !data.ok) {
                throw new Error(data.error || "Finalize failed.");
              }
              await handleStatusResult(runId, data);
            })().catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : "Finalize failed.");
              if (stage === 1) setStage1Status("idle");
              if (stage === 2) setStage2Status("idle");
            });
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onerror = () => {
        setLiveMessage("WebSocket error — falling back to HTTPS sync.");
        teardownWs();
        startFallbackSync(runId);
      };
      ws.onclose = () => {
        clearTimers();
        wsRef.current = null;
      };
    },
    [
      applyWsPayload,
      clearTimers,
      delegateAuthHeaders,
      handleStatusResult,
      startFallbackSync,
      teardownWs,
    ],
  );

  useEffect(() => () => teardownWs(), [teardownWs]);

  const onSubmit = async () => {
    if (!file) return;
    fileRef.current = file;
    stage2StartedRef.current = false;
    setError(null);
    setPreview(null);
    setActivity([]);
    setStage1Vote(null);
    setStage2Vote(null);
    setStage1Status("active");
    setStage2Status("idle");
    setProgress({ done: 0, total: 0 });
    setLiveMessage("Uploading image and starting Stage 1…");
    runIdRef.current = null;

    const fd = new FormData();
    fd.set("image", file);

    try {
      const res = await fetch("/api/predictions/pipeline-run", {
        method: "POST",
        body: fd,
        credentials: "include",
        headers: delegateAuthHeaders,
      });
      const data = (await res.json()) as PipelineSubmitResponse & { error?: string };
      if (!res.ok || !data.id || !data.stage?.externalJobId) {
        throw new Error(data.error || "Upload failed.");
      }

      runIdRef.current = data.id;
      setProgress({ done: 0, total: data.stage.totalModels ?? 0 });

      if (data.stage.stage === 1) {
        setStage1Status("active");
        connectWebSocket(data.stage.externalJobId, data.id, 1);
      } else {
        setStage1Status("skipped");
        setStage2Status("active");
        connectWebSocket(data.stage.externalJobId, data.id, 2);
      }
    } catch (reason) {
      setStage1Status("idle");
      setStage2Status("idle");
      setError(reason instanceof Error ? reason.message : "Upload failed.");
      setLiveMessage("");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const selected = e.dataTransfer.files?.[0];
    if (selected) setFile(selected);
  };

  const stage1ResultLabel =
    stage1Vote?.majorityClass === 0
      ? "Fecal"
      : stage1Vote?.majorityClass === 1
        ? "Non-fecal"
        : stage1Status === "active"
          ? "Running"
          : "Waiting";
  const stage2ResultLabel =
    stage2Vote?.majorityClass === 0
      ? "Helminths detected"
      : stage2Vote?.majorityClass === 1
        ? "No helminths"
        : stage2Status === "skipped"
          ? "Not run (Stage 1 was non-fecal)"
          : stage2Status === "active"
            ? "Running"
            : "Waiting";

  return (
    <div className="space-y-6">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>

      <div className="rounded-xl border border-border/60 bg-gradient-to-b from-background to-muted/20 p-5">
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Three-phase pipeline
        </p>
        <p className="mb-4 text-sm text-muted-foreground">
          Stage 1 (fecal detection) runs first. Stage 2 (helminth screening)
          runs only when Stage 1 is fecal-positive. Stage 3 is displayed for
          roadmap context.
        </p>
        <PipelineStepper steps={stepperStatuses} />
      </div>

      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <div
        className={cn(
          "flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-all",
          isDragging
            ? "border-primary bg-primary/[0.04]"
            : "border-border bg-gradient-to-b from-muted/10 to-muted/30 hover:border-primary/40",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Upload className="size-8" aria-hidden />
        </div>
        <div>
          <p className="text-base font-medium text-foreground">
            Stages 1 → 2 pipeline screening
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            PNG, JPEG, WebP, or TIFF · max 15 MB
          </p>
        </div>
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/tiff"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="inline-flex h-10 items-center justify-center rounded-md bg-secondary px-4 text-sm font-medium text-secondary-foreground hover:bg-secondary/90">
            Choose file
          </span>
        </label>
        {file && (
          <p className="text-xs text-muted-foreground">
            Selected: <span className="font-mono text-foreground">{file.name}</span>{" "}
            ({(file.size / 1024).toFixed(0)} KB)
          </p>
        )}
        <Button
          type="button"
          className="h-10"
          disabled={!file || isRunning}
          onClick={() => void onSubmit()}
        >
          {isRunning ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              Pipeline running…
            </>
          ) : (
            <>
              <Radio className="mr-2 size-4" aria-hidden />
              Run staged pipeline
            </>
          )}
        </Button>
        {isRunning && (
          <div className="w-full max-w-md space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {currentStageRef.current === 2 ? "Stage 2" : "Stage 1"} progress:{" "}
              {progress.done} / {progress.total}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-6">
          {(stage1Vote || stage2Vote || stage1Status !== "idle" || stage2Status !== "idle") && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="border-border/80">
                <CardHeader>
                  <CardTitle className="text-base">Stage 1 result</CardTitle>
                  <CardDescription>
                    {stage1Vote
                      ? `Fecal votes: ${stage1Vote.positiveVotes} · Non-fecal votes: ${stage1Vote.negativeVotes}`
                      : "Waiting for Stage 1 output."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold">{stage1ResultLabel}</p>
                </CardContent>
              </Card>
              <Card className="border-border/80">
                <CardHeader>
                  <CardTitle className="text-base">Stage 2 result</CardTitle>
                  <CardDescription>
                    {stage2Vote
                      ? `Helminths votes: ${stage2Vote.positiveVotes} · Non-helminths votes: ${stage2Vote.negativeVotes}`
                      : "Runs only when Stage 1 result is fecal."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold">{stage2ResultLabel}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {activity.length > 0 && (
            <Card className="border-border/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Clock3 className="size-4 text-muted-foreground" aria-hidden />
                  Live activity feed
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {activity.slice(0, 20).map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
                  >
                    <p className="font-medium">
                      Stage {entry.stage} · {shortModelName(entry.modelFilename)}
                    </p>
                    {entry.error ? (
                      <p className="text-destructive">{entry.error}</p>
                    ) : (
                      <p className="text-muted-foreground">
                        {classLabel(entry.stage, entry.predictedClass)}
                        {entry.confidencePct !== null
                          ? ` · confidence ${entry.confidencePct.toFixed(1)}%`
                          : ""}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {preview && (preview.results.length > 0 || preview.errors.length > 0) && (
            <Card className="border-border/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                  Latest stage results
                </CardTitle>
                <CardDescription>
                  Live model outputs translated into user-friendly labels.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(preview.results as Array<Record<string, unknown>>).map((row, i) => {
                  const fn = String(row.modelFilename ?? "");
                  const cls = row.classification as Record<string, unknown> | undefined;
                  const predictedClass =
                    typeof cls?.predicted_class === "number" ? cls.predicted_class : null;
                  const classProbabilities =
                    cls?.class_probabilities && typeof cls.class_probabilities === "object"
                      ? (cls.class_probabilities as Record<string, number>)
                      : undefined;
                  const confidence = toConfidencePercent({
                    predicted_class: predictedClass ?? undefined,
                    max_prob: typeof cls?.max_prob === "number" ? cls.max_prob : undefined,
                    class_probabilities: classProbabilities,
                  });
                  return (
                    <div
                      key={`${fn}-${i}`}
                      className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm"
                    >
                      <p className="font-medium">{shortModelName(fn)}</p>
                      <p className="text-muted-foreground">
                        Result:{" "}
                        <span className="font-medium text-foreground">
                          {classLabel(currentStageRef.current ?? 1, predictedClass)}
                        </span>
                        {" · "}
                        Confidence:{" "}
                        <span className="font-medium text-foreground">
                          {confidence !== null ? `${confidence.toFixed(1)}%` : "—"}
                        </span>
                      </p>
                      {classProbabilities ? (
                        <p className="text-xs text-muted-foreground">
                          Class probabilities: 0={String(classProbabilities["0"] ?? "—")}
                          {" · "}1={String(classProbabilities["1"] ?? "—")}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {(preview.errors as Array<Record<string, unknown>>).map((row, i) => (
                  <div
                    key={`err-${i}`}
                    className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {String(row.modelFilename ?? "Model")}: {String(row.error ?? "Error")}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
      </div>
    </div>
  );
}
