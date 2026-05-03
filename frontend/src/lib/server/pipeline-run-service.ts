import {
  HELMINTH_MODEL_FILENAMES,
  HELMINTH_MODEL_INPUT_SIZE,
  STAGE1_MODEL_FILENAMES,
  STAGE1_MODEL_INPUT_SIZE,
  STAGE2_MODEL_FILENAMES,
  STAGE2_MODEL_INPUT_SIZE,
  getHelminthApiBaseUrl,
} from "@/lib/helminth-config";
import {
  assertCanStartPipelineRun,
  getPipelineRunForUser,
  getPipelineDashboardStats,
  insertPipelineRun,
  listPipelineHistory,
  markPipelineRunFailed,
  saveStage1Result,
  saveStage2Result,
  updatePipelineRunImageObjectKey,
  updateStage1ExternalJobId,
  updateStage2ExternalJobId,
  type PipelineRunStatus,
  type PredictionPipelineRunRow,
  type VoteSummary,
} from "@/lib/pipeline-db";
import {
  buildPredictionImageObjectKey,
  deletePredictionImage,
  uploadPredictionImage,
} from "@/lib/server/prediction-image-storage";
import {
  fetchHelminthJobStatus,
  type HelminthStatusPayload,
} from "@/lib/helminth-remote";

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
  "image/x-png",
]);

type StageNumber = 1 | 2;

type StartMode = "pipeline" | "stage2-only";

export type PipelineErr = { ok: false; error: string; code?: string };

export type PipelineSubmitOk = {
  ok: true;
  id: string;
  stage: {
    stage: StageNumber;
    externalJobId: string;
    totalModels: number;
  };
};

export type PipelineStage2StartOk = {
  ok: true;
  stage: {
    stage: 2;
    externalJobId: string;
    totalModels: number;
  };
  idempotent?: boolean;
};

export type PipelineFinalizeOk = {
  ok: true;
  runStatus: PipelineRunStatus;
  stage: StageNumber | null;
  persisted: boolean;
  remote?: Record<string, unknown>;
  gateDecision?: "fecal" | "non_fecal";
  awaitingStage2Start?: boolean;
  idempotent?: boolean;
};

export type PipelineSyncOk = {
  ok: true;
  runStatus: PipelineRunStatus;
  stage: StageNumber | null;
  persisted: boolean;
  remote?: Record<string, unknown>;
  gateDecision?: "fecal" | "non_fecal";
  awaitingStage2Start?: boolean;
};

type BatchStartResult = {
  externalJobId: string;
  totalModels: number;
};

type RemoteResultItem = {
  modelFilename?: unknown;
  classification?: {
    predicted_class?: unknown;
    max_prob?: unknown;
    probability?: unknown;
    class_probabilities?: Record<string, unknown>;
  };
};

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function toBinaryOrNull(value: unknown): 0 | 1 | null {
  if (value === 0 || value === 1) return value;
  return null;
}

function toPercentConfidence(
  classification: RemoteResultItem["classification"] | undefined,
): number | null {
  if (!classification || typeof classification !== "object") return null;

  const predicted = toBinaryOrNull(classification.predicted_class);
  const probs = classification.class_probabilities;
  if (
    probs &&
    typeof probs === "object" &&
    predicted !== null &&
    String(predicted) in probs
  ) {
    const raw = (probs as Record<string, unknown>)[String(predicted)];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw <= 1 ? raw * 100 : raw;
    }
  }

  if (
    typeof classification.max_prob === "number" &&
    Number.isFinite(classification.max_prob)
  ) {
    return classification.max_prob <= 1
      ? classification.max_prob * 100
      : classification.max_prob;
  }
  return null;
}

function fileValidationError(file: File): string | null {
  if (file.size === 0) {
    return "Empty file.";
  }
  if (file.size > MAX_BYTES) {
    return `File too large (max ${MAX_BYTES / (1024 * 1024)} MB).`;
  }
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED.has(mime)) {
    return "Unsupported image type. Use JPEG, PNG, WebP, or TIFF.";
  }
  return null;
}

function dbErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : "Database error";
  if (message.includes("DATABASE_URL")) {
    return "Database is not configured (DATABASE_URL).";
  }
  return message;
}

function runError(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Server error";
}

function getStage1MajorityClass(run: PredictionPipelineRunRow): 0 | 1 | null {
  const summary = toRecord(run.stage1_vote_summary);
  const candidate = summary.majorityClass;
  if (candidate === 0 || candidate === 1) {
    return candidate;
  }

  const payload = toRecord(run.stage1_result_payload);
  const resultsRaw = payload.results;
  const results = Array.isArray(resultsRaw) ? resultsRaw : [];
  let positiveVotes = 0;
  let negativeVotes = 0;
  for (const item of results) {
    const cls = toRecord(toRecord(item).classification).predicted_class;
    if (cls === 0) positiveVotes++;
    if (cls === 1) negativeVotes++;
  }
  return positiveVotes > negativeVotes ? 0 : 1;
}

function isStage1Positive(run: PredictionPipelineRunRow): boolean {
  // Stage 1 mapping: 0 = fecal, 1 = non-fecal.
  return getStage1MajorityClass(run) === 0;
}

function activeStage(run: PredictionPipelineRunRow): StageNumber | null {
  if (run.status !== "processing") return null;
  if (run.stage2_status === "processing") return 2;
  if (run.stage1_status === "processing") return 1;
  return null;
}

function shouldAwaitStage2Start(run: PredictionPipelineRunRow): boolean {
  return (
    run.status === "processing" &&
    run.stage1_status === "finished" &&
    run.stage2_status === "pending" &&
    isStage1Positive(run)
  );
}

function persistedPayload(run: PredictionPipelineRunRow): Record<string, unknown> | undefined {
  if (run.stage2_result_payload) return toRecord(run.stage2_result_payload);
  if (run.stage1_result_payload) return toRecord(run.stage1_result_payload);
  return undefined;
}

function buildVoteSummary(
  payload: HelminthStatusPayload,
  expectedModelFilenames: readonly string[],
): VoteSummary {
  const byModel = new Map<
    string,
    { predictedClass: number | null; maxProb: number | null }
  >();
  const results = Array.isArray(payload.results) ? payload.results : [];

  for (const entry of results) {
    const row = entry as RemoteResultItem;
    const modelFilename =
      typeof row.modelFilename === "string" ? row.modelFilename : null;
    if (!modelFilename) continue;
    const predictedClass = toBinaryOrNull(row.classification?.predicted_class);
    const maxProb = toPercentConfidence(row.classification);
    byModel.set(modelFilename, { predictedClass, maxProb });
  }

  const modelVotes = expectedModelFilenames.map((modelFilename) => {
    const vote = byModel.get(modelFilename);
    return {
      modelFilename,
      predictedClass: vote?.predictedClass ?? null,
      maxProb: vote?.maxProb ?? null,
    };
  });

  // Class mapping in this project:
  // Stage 1: 0=fecal, 1=non-fecal
  // Stage 2: 0=helminths, 1=non-helminths
  const positiveVotes = modelVotes.filter((v) => v.predictedClass === 0).length;
  const negativeVotes = modelVotes.filter((v) => v.predictedClass === 1).length;

  return {
    totalModels: expectedModelFilenames.length,
    positiveVotes,
    negativeVotes,
    majorityClass: positiveVotes > negativeVotes ? 0 : 1,
    modelVotes,
  };
}

async function startRemoteBatch(params: {
  file: File;
  modelInputFeatureSize: number;
  modelFilenames: readonly string[];
}): Promise<BatchStartResult> {
  const forward = new FormData();
  forward.set("modelInputFeatureSize", String(params.modelInputFeatureSize));
  for (const filename of params.modelFilenames) {
    forward.append("modelFilenames", filename);
  }
  forward.set("image", params.file, params.file.name || "upload.jpg");

  const base = getHelminthApiBaseUrl();
  let remote: Response;
  try {
    remote = await fetch(`${base}/predict/batch`, {
      method: "POST",
      body: forward,
      cache: "no-store",
    });
  } catch (reason) {
    throw new Error(`Could not reach helminth API: ${runError(reason)}`);
  }

  if (!remote.ok) {
    const detail = await remote.text();
    throw new Error(`Batch HTTP ${remote.status}: ${detail.slice(0, 500)}`);
  }

  const body = (await remote.json()) as {
    job_id?: unknown;
    total_models?: unknown;
  };
  const externalJobId = typeof body.job_id === "string" ? body.job_id : "";
  if (!externalJobId) {
    throw new Error("Helminth API returned no job_id.");
  }

  const totalModels =
    typeof body.total_models === "number" && Number.isFinite(body.total_models)
      ? body.total_models
      : params.modelFilenames.length;

  return { externalJobId, totalModels };
}

async function fetchStageStatus(
  run: PredictionPipelineRunRow,
  stage: StageNumber,
): Promise<HelminthStatusPayload> {
  const externalJobId =
    stage === 1 ? run.stage1_external_job_id : run.stage2_external_job_id;
  if (!externalJobId) {
    throw new Error(`Stage ${stage} has no external job id yet.`);
  }
  return fetchHelminthJobStatus(externalJobId);
}

async function saveFinishedStage1(params: {
  run: PredictionPipelineRunRow;
  userId: string;
  remote: HelminthStatusPayload;
}): Promise<{
  runStatus: PipelineRunStatus;
  gateDecision: "fecal" | "non_fecal";
  awaitingStage2Start: boolean;
}> {
  const voteSummary = buildVoteSummary(params.remote, STAGE1_MODEL_FILENAMES);
  const isFecal = voteSummary.majorityClass === 0;
  await saveStage1Result({
    runId: params.run.id,
    userId: params.userId,
    payload: params.remote,
    voteSummary,
    isFecal,
  });
  return {
    runStatus: isFecal ? "processing" : "finished",
    gateDecision: isFecal ? "fecal" : "non_fecal",
    awaitingStage2Start: isFecal,
  };
}

async function saveFinishedStage2(params: {
  run: PredictionPipelineRunRow;
  userId: string;
  remote: HelminthStatusPayload;
}): Promise<{
  runStatus: PipelineRunStatus;
}> {
  const voteSummary = buildVoteSummary(params.remote, STAGE2_MODEL_FILENAMES);
  const finalOutcome =
    voteSummary.majorityClass === 0
      ? "helminth_positive"
      : "helminth_negative";
  await saveStage2Result({
    runId: params.run.id,
    userId: params.userId,
    payload: params.remote,
    voteSummary,
    finalOutcome,
  });
  return { runStatus: "finished" };
}

async function startRun(
  userId: string,
  file: File,
  mode: StartMode,
): Promise<PipelineSubmitOk | PipelineErr> {
  const validationErr = fileValidationError(file);
  if (validationErr) {
    return { ok: false, error: validationErr };
  }

  try {
    await assertCanStartPipelineRun(userId);
  } catch (reason) {
    return { ok: false, error: runError(reason), code: "429" };
  }

  const runId = crypto.randomUUID();
  const stage: StageNumber = mode === "pipeline" ? 1 : 2;
  const imageObjectKey = buildPredictionImageObjectKey({
    userId,
    runId,
    mimeType: file.type || "application/octet-stream",
  });
  const modelFilenames =
    stage === 1 ? STAGE1_MODEL_FILENAMES : HELMINTH_MODEL_FILENAMES;
  const modelInputFeatureSize =
    stage === 1 ? STAGE1_MODEL_INPUT_SIZE : HELMINTH_MODEL_INPUT_SIZE;

  try {
    await insertPipelineRun({
      userId,
      runId,
      originalFilename: file.name || null,
      imageObjectKey: null,
      stage1Status: stage === 1 ? "processing" : "skipped",
      stage2Status: stage === 1 ? "pending" : "processing",
    });
  } catch (reason) {
    return { ok: false, error: dbErrorMessage(reason) };
  }

  try {
    await uploadPredictionImage({
      objectKey: imageObjectKey,
      file,
    });
    await updatePipelineRunImageObjectKey({
      runId,
      userId,
      imageObjectKey,
    });
  } catch (reason) {
    const message = `Could not store uploaded image: ${runError(reason)}`;
    await markPipelineRunFailed({
      runId,
      userId,
      stage,
      message,
    });
    try {
      await deletePredictionImage(imageObjectKey);
    } catch {
      // Best effort cleanup for partially written objects.
    }
    return { ok: false, error: message };
  }

  let batch: BatchStartResult;
  try {
    batch = await startRemoteBatch({
      file,
      modelInputFeatureSize,
      modelFilenames,
    });
  } catch (reason) {
    const message = runError(reason);
    await markPipelineRunFailed({
      runId,
      userId,
      stage,
      message,
    });
    return { ok: false, error: message };
  }

  try {
    if (stage === 1) {
      await updateStage1ExternalJobId({
        runId,
        userId,
        externalJobId: batch.externalJobId,
      });
    } else {
      await updateStage2ExternalJobId({
        runId,
        userId,
        externalJobId: batch.externalJobId,
      });
    }
  } catch (reason) {
    await markPipelineRunFailed({
      runId,
      userId,
      stage,
      message: `Could not save job id: ${runError(reason)}`,
    });
    return { ok: false, error: "Could not save run after starting job." };
  }

  return {
    ok: true,
    id: runId,
    stage: {
      stage,
      externalJobId: batch.externalJobId,
      totalModels: batch.totalModels,
    },
  };
}

export async function serviceSubmitPipelineRun(
  userId: string,
  file: File,
): Promise<PipelineSubmitOk | PipelineErr> {
  return startRun(userId, file, "pipeline");
}

export async function serviceSubmitStage2OnlyRun(
  userId: string,
  file: File,
): Promise<PipelineSubmitOk | PipelineErr> {
  return startRun(userId, file, "stage2-only");
}

export async function serviceStartPipelineStage2(
  userId: string,
  runId: string,
  file: File,
): Promise<PipelineStage2StartOk | PipelineErr> {
  const validationErr = fileValidationError(file);
  if (validationErr) {
    return { ok: false, error: validationErr };
  }

  const run = await getPipelineRunForUser(runId, userId);
  if (!run) {
    return { ok: false, error: "Not found." };
  }

  if (run.status !== "processing") {
    return { ok: false, error: "Run is not in processing state." };
  }

  if (run.stage2_status === "processing" && run.stage2_external_job_id) {
    return {
      ok: true,
      idempotent: true,
      stage: {
        stage: 2,
        externalJobId: run.stage2_external_job_id,
        totalModels: STAGE2_MODEL_FILENAMES.length,
      },
    };
  }

  if (run.stage2_status === "finished") {
    return { ok: false, error: "Stage 2 already finished." };
  }

  if (run.stage2_status === "skipped") {
    return { ok: false, error: "Stage 2 was skipped for this run." };
  }

  if (run.stage1_status !== "finished") {
    return { ok: false, error: "Stage 1 is not complete yet." };
  }
  if (!isStage1Positive(run)) {
    return {
      ok: false,
      error: "Stage 2 cannot start because Stage 1 is non-fecal.",
    };
  }

  let batch: BatchStartResult;
  try {
    batch = await startRemoteBatch({
      file,
      modelInputFeatureSize: STAGE2_MODEL_INPUT_SIZE,
      modelFilenames: STAGE2_MODEL_FILENAMES,
    });
  } catch (reason) {
    const message = runError(reason);
    await markPipelineRunFailed({
      runId,
      userId,
      stage: 2,
      message,
    });
    return { ok: false, error: message };
  }

  try {
    await updateStage2ExternalJobId({
      runId,
      userId,
      externalJobId: batch.externalJobId,
    });
  } catch (reason) {
    const message = runError(reason);
    await markPipelineRunFailed({
      runId,
      userId,
      stage: 2,
      message: `Could not save stage 2 job id: ${message}`,
    });
    return { ok: false, error: "Could not save Stage 2 job id." };
  }

  return {
    ok: true,
    stage: {
      stage: 2,
      externalJobId: batch.externalJobId,
      totalModels: batch.totalModels,
    },
  };
}

export async function serviceFinalizePipelineRun(
  userId: string,
  runId: string,
): Promise<PipelineFinalizeOk | PipelineErr> {
  const run = await getPipelineRunForUser(runId, userId);
  if (!run) {
    return { ok: false, error: "Not found." };
  }

  if (run.status === "finished") {
    return {
      ok: true,
      idempotent: true,
      runStatus: run.status,
      stage: null,
      persisted: true,
      remote: persistedPayload(run),
      gateDecision: run.stage2_status === "skipped" ? "non_fecal" : undefined,
    };
  }

  if (run.status === "failed") {
    return { ok: false, error: run.error_message || "Run failed." };
  }

  const stage = activeStage(run);
  if (!stage) {
    if (shouldAwaitStage2Start(run)) {
      return {
        ok: true,
        runStatus: "processing",
        stage: 2,
        persisted: true,
        gateDecision: "fecal",
        awaitingStage2Start: true,
      };
    }
    return {
      ok: true,
      idempotent: true,
      runStatus: run.status,
      stage: null,
      persisted: false,
    };
  }

  let remote: HelminthStatusPayload;
  try {
    remote = await fetchStageStatus(run, stage);
  } catch (reason) {
    const message = runError(reason);
    await markPipelineRunFailed({
      runId: run.id,
      userId,
      stage,
      message,
    });
    return { ok: false, error: message };
  }

  const remoteObj = toRecord(remote);
  if (remote.status !== "finished") {
    if (remote.status === "failed") {
      const msg = `Stage ${stage} failed in remote API.`;
      await markPipelineRunFailed({
        runId: run.id,
        userId,
        stage,
        message: msg,
      });
      return { ok: false, error: msg };
    }
    return { ok: false, error: `Stage ${stage} not finished yet.` };
  }

  try {
    if (stage === 1) {
      const stage1 = await saveFinishedStage1({
        run,
        userId,
        remote,
      });
      return {
        ok: true,
        runStatus: stage1.runStatus,
        stage: 1,
        persisted: true,
        remote: remoteObj,
        gateDecision: stage1.gateDecision,
        awaitingStage2Start: stage1.awaitingStage2Start,
      };
    }

    const stage2 = await saveFinishedStage2({
      run,
      userId,
      remote,
    });
    return {
      ok: true,
      runStatus: stage2.runStatus,
      stage: 2,
      persisted: true,
      remote: remoteObj,
    };
  } catch (reason) {
    const message = runError(reason);
    await markPipelineRunFailed({
      runId: run.id,
      userId,
      stage,
      message,
    });
    return { ok: false, error: message };
  }
}

export async function serviceSyncPipelineRun(
  userId: string,
  runId: string,
): Promise<PipelineSyncOk | PipelineErr> {
  const run = await getPipelineRunForUser(runId, userId);
  if (!run) {
    return { ok: false, error: "Not found." };
  }

  if (run.status === "finished") {
    return {
      ok: true,
      runStatus: run.status,
      stage: null,
      persisted: true,
      remote: persistedPayload(run),
      gateDecision: run.stage2_status === "skipped" ? "non_fecal" : undefined,
    };
  }

  if (run.status === "failed") {
    return { ok: false, error: run.error_message || "Run failed." };
  }

  const stage = activeStage(run);
  if (!stage) {
    if (shouldAwaitStage2Start(run)) {
      return {
        ok: true,
        runStatus: "processing",
        stage: 2,
        persisted: true,
        gateDecision: "fecal",
        awaitingStage2Start: true,
      };
    }
    return {
      ok: true,
      runStatus: run.status,
      stage: null,
      persisted: false,
    };
  }

  let remote: HelminthStatusPayload;
  try {
    remote = await fetchStageStatus(run, stage);
  } catch (reason) {
    return { ok: false, error: runError(reason) };
  }

  const remoteObj = toRecord(remote);
  if (remote.status !== "finished") {
    if (remote.status === "failed") {
      const message = `Stage ${stage} failed in remote API.`;
      await markPipelineRunFailed({
        runId: run.id,
        userId,
        stage,
        message,
      });
      return { ok: false, error: message };
    }
    return {
      ok: true,
      runStatus: "processing",
      stage,
      persisted: false,
      remote: remoteObj,
    };
  }

  try {
    if (stage === 1) {
      const stage1 = await saveFinishedStage1({
        run,
        userId,
        remote,
      });
      return {
        ok: true,
        runStatus: stage1.runStatus,
        stage: 1,
        persisted: true,
        remote: remoteObj,
        gateDecision: stage1.gateDecision,
        awaitingStage2Start: stage1.awaitingStage2Start,
      };
    }

    const stage2 = await saveFinishedStage2({
      run,
      userId,
      remote,
    });
    return {
      ok: true,
      runStatus: stage2.runStatus,
      stage: 2,
      persisted: true,
      remote: remoteObj,
    };
  } catch (reason) {
    return { ok: false, error: runError(reason) };
  }
}

export async function serviceListPipelineHistory(
  userId: string,
  limit: number,
  offset = 0,
): Promise<{ ok: true; items: PredictionPipelineRunRow[] } | PipelineErr> {
  try {
    const items = await listPipelineHistory(userId, limit, offset);
    return { ok: true, items };
  } catch (reason) {
    return { ok: false, error: dbErrorMessage(reason) };
  }
}

export async function serviceGetPipelineStats(
  userId: string,
): Promise<
  | {
      ok: true;
      stats: {
        totalPredictions: number;
        fecalDetectedStage1: number;
        helminthPositivePhase2: number;
      };
    }
  | PipelineErr
> {
  try {
    const stats = await getPipelineDashboardStats(userId);
    return { ok: true, stats };
  } catch (reason) {
    return { ok: false, error: dbErrorMessage(reason) };
  }
}
