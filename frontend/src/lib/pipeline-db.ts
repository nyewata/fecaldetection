import { getSql } from "@/lib/db";

export type PipelineRunStatus = "processing" | "finished" | "failed" | "timed_out";
export type StageRunStatus =
  | "pending"
  | "processing"
  | "finished"
  | "failed"
  | "skipped";

export type VoteSummary = {
  totalModels: number;
  positiveVotes: number;
  negativeVotes: number;
  majorityClass: 0 | 1;
  modelVotes: Array<{
    modelFilename: string;
    predictedClass: number | null;
    maxProb: number | null;
  }>;
};

export type PredictionPipelineRunRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  status: PipelineRunStatus;
  original_filename: string | null;
  image_object_key: string | null;
  stage1_status: StageRunStatus;
  stage2_status: StageRunStatus;
  stage3_status: StageRunStatus;
  stage1_external_job_id: string | null;
  stage2_external_job_id: string | null;
  stage3_external_job_id: string | null;
  stage1_result_payload: unknown | null;
  stage2_result_payload: unknown | null;
  stage3_result_payload: unknown | null;
  stage3_annotated_image_object_key: string | null;
  stage1_vote_summary: VoteSummary | null;
  stage2_vote_summary: VoteSummary | null;
  final_outcome: string | null;
  error_message: string | null;
};

const MAX_CONCURRENT_PROCESSING = 3;

export async function countProcessingRuns(userId: string): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS c
    FROM prediction_pipeline_runs
    WHERE user_id = ${userId} AND status = 'processing'
  `;
  const row = rows[0] as { c: number } | undefined;
  return row?.c ?? 0;
}

export async function assertCanStartPipelineRun(userId: string): Promise<void> {
  const n = await countProcessingRuns(userId);
  if (n >= MAX_CONCURRENT_PROCESSING) {
    throw new Error("Too many runs in progress. Wait for one to finish.");
  }
}

export async function insertPipelineRun(params: {
  userId: string;
  runId: string;
  originalFilename: string | null;
  imageObjectKey?: string | null;
  stage1Status?: StageRunStatus;
  stage2Status?: StageRunStatus;
  stage3Status?: StageRunStatus;
}): Promise<void> {
  const sql = getSql();
  const stage1Status = params.stage1Status ?? "processing";
  const stage2Status = params.stage2Status ?? "pending";
  const stage3Status = params.stage3Status ?? "pending";
  await sql`
    INSERT INTO prediction_pipeline_runs (
      id, user_id, status, original_filename, image_object_key, stage1_status, stage2_status, stage3_status
    ) VALUES (
      ${params.runId}::uuid,
      ${params.userId},
      'processing',
      ${params.originalFilename},
      ${params.imageObjectKey ?? null},
      ${stage1Status},
      ${stage2Status},
      ${stage3Status}
    )
  `;
}

export async function updatePipelineRunImageObjectKey(params: {
  runId: string;
  userId: string;
  imageObjectKey: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE prediction_pipeline_runs
    SET image_object_key = ${params.imageObjectKey},
        updated_at = now()
    WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
  `;
}

export async function updateStage1ExternalJobId(params: {
  runId: string;
  userId: string;
  externalJobId: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE prediction_pipeline_runs
    SET stage1_external_job_id = ${params.externalJobId},
        stage1_status = 'processing',
        updated_at = now()
    WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
  `;
}

export async function updateStage2ExternalJobId(params: {
  runId: string;
  userId: string;
  externalJobId: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE prediction_pipeline_runs
    SET stage2_external_job_id = ${params.externalJobId},
        stage2_status = 'processing',
        updated_at = now()
    WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
  `;
}

export async function updateStage3ExternalJobId(params: {
  runId: string;
  userId: string;
  externalJobId: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE prediction_pipeline_runs
    SET stage3_external_job_id = ${params.externalJobId},
        stage3_status = 'processing',
        updated_at = now()
    WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
  `;
}

export async function saveStage1Result(params: {
  runId: string;
  userId: string;
  payload: unknown;
  voteSummary: VoteSummary;
  isFecal: boolean;
}): Promise<void> {
  const sql = getSql();
  const payloadJson = JSON.stringify(params.payload);
  const voteSummaryJson = JSON.stringify(params.voteSummary);
  if (params.isFecal) {
    await sql`
      UPDATE prediction_pipeline_runs
      SET stage1_status = 'finished',
          stage1_result_payload = ${payloadJson}::jsonb,
          stage1_vote_summary = ${voteSummaryJson}::jsonb,
          stage2_status = 'pending',
          stage3_status = 'pending',
          updated_at = now()
      WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
    `;
    return;
  }

  await sql`
    UPDATE prediction_pipeline_runs
    SET status = 'finished',
        stage1_status = 'finished',
        stage2_status = 'skipped',
        stage3_status = 'skipped',
        stage1_result_payload = ${payloadJson}::jsonb,
        stage1_vote_summary = ${voteSummaryJson}::jsonb,
        final_outcome = 'non_fecal',
        error_message = NULL,
        updated_at = now()
    WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
  `;
}

export async function saveStage2Result(params: {
  runId: string;
  userId: string;
  payload: unknown;
  voteSummary: VoteSummary;
  finalOutcome: "helminth_positive" | "helminth_negative";
  /** When true, run stays `processing` and Stage 3 is started by the client. */
  awaitStage3: boolean;
}): Promise<void> {
  const sql = getSql();
  const payloadJson = JSON.stringify(params.payload);
  const voteSummaryJson = JSON.stringify(params.voteSummary);
  if (params.awaitStage3) {
    await sql`
      UPDATE prediction_pipeline_runs
      SET status = 'processing',
          stage2_status = 'finished',
          stage2_result_payload = ${payloadJson}::jsonb,
          stage2_vote_summary = ${voteSummaryJson}::jsonb,
          final_outcome = ${params.finalOutcome},
          stage3_status = 'pending',
          error_message = NULL,
          updated_at = now()
      WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
    `;
    return;
  }
  await sql`
    UPDATE prediction_pipeline_runs
    SET status = 'finished',
        stage2_status = 'finished',
        stage2_result_payload = ${payloadJson}::jsonb,
        stage2_vote_summary = ${voteSummaryJson}::jsonb,
        final_outcome = ${params.finalOutcome},
        stage3_status = 'skipped',
        error_message = NULL,
        updated_at = now()
    WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
  `;
}

export async function saveStage3Result(params: {
  runId: string;
  userId: string;
  payload: unknown;
  annotatedImageObjectKey?: string | null;
}): Promise<void> {
  const sql = getSql();
  const payloadJson = JSON.stringify(params.payload);
  const annotatedKey = params.annotatedImageObjectKey ?? null;
  await sql`
    UPDATE prediction_pipeline_runs
    SET status = 'finished',
        stage3_status = 'finished',
        stage3_result_payload = ${payloadJson}::jsonb,
        stage3_annotated_image_object_key = ${annotatedKey},
        error_message = NULL,
        updated_at = now()
    WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
  `;
}

export async function markPipelineRunFailed(params: {
  runId: string;
  userId: string;
  message: string;
  stage?: 1 | 2 | 3;
}): Promise<void> {
  const sql = getSql();
  const stageStatus =
    params.stage === 1
      ? sql`stage1_status = 'failed',`
      : params.stage === 2
        ? sql`stage2_status = 'failed',`
        : params.stage === 3
          ? sql`stage3_status = 'failed',`
          : sql``;
  await sql`
    UPDATE prediction_pipeline_runs
    SET status = 'failed',
        ${stageStatus}
        error_message = ${params.message},
        updated_at = now()
    WHERE id = ${params.runId}::uuid AND user_id = ${params.userId}
  `;
}

export async function getPipelineRunForUser(
  runId: string,
  userId: string,
): Promise<PredictionPipelineRunRow | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, user_id, created_at, updated_at, status, original_filename,
           image_object_key,
           stage1_status, stage2_status, stage3_status,
           stage1_external_job_id, stage2_external_job_id, stage3_external_job_id,
           stage1_result_payload, stage2_result_payload, stage3_result_payload,
           stage3_annotated_image_object_key,
           stage1_vote_summary, stage2_vote_summary,
           final_outcome, error_message
    FROM prediction_pipeline_runs
    WHERE id = ${runId}::uuid AND user_id = ${userId}
    LIMIT 1
  `;
  return (rows[0] as PredictionPipelineRunRow | undefined) ?? null;
}

export async function listPipelineHistory(
  userId: string,
  limit: number,
  offset = 0,
): Promise<PredictionPipelineRunRow[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, user_id, created_at, updated_at, status, original_filename,
           image_object_key,
           stage1_status, stage2_status, stage3_status,
           stage1_external_job_id, stage2_external_job_id, stage3_external_job_id,
           stage1_result_payload, stage2_result_payload, stage3_result_payload,
           stage3_annotated_image_object_key,
           stage1_vote_summary, stage2_vote_summary,
           final_outcome, error_message
    FROM prediction_pipeline_runs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows as PredictionPipelineRunRow[];
}

export async function getPipelineDashboardStats(userId: string): Promise<{
  totalPredictions: number;
  fecalDetectedStage1: number;
  helminthPositivePhase2: number;
  speciesDetectionsCount: number;
}> {
  const sql = getSql();
  const totalRows = await sql`
    SELECT COUNT(*)::int AS c
    FROM prediction_pipeline_runs
    WHERE user_id = ${userId} AND status = 'finished'
  `;
  const totalPredictions = (totalRows[0] as { c: number } | undefined)?.c ?? 0;

  const fecalRows = await sql`
    SELECT COUNT(*)::int AS c
    FROM prediction_pipeline_runs
    WHERE user_id = ${userId}
      AND status = 'finished'
      AND stage1_status = 'finished'
      AND stage1_vote_summary->>'majorityClass' = '0'
  `;
  const fecalDetectedStage1 =
    (fecalRows[0] as { c: number } | undefined)?.c ?? 0;

  const posRows = await sql`
    SELECT COUNT(*)::int AS c
    FROM prediction_pipeline_runs
    WHERE user_id = ${userId}
      AND status = 'finished'
      AND final_outcome = 'helminth_positive'
  `;
  const helminthPositivePhase2 =
    (posRows[0] as { c: number } | undefined)?.c ?? 0;

  const speciesRows = await sql`
    SELECT COALESCE(SUM(run_detections), 0)::int AS c
    FROM (
      SELECT (
        SELECT COALESCE(SUM(
          CASE
            WHEN jsonb_typeof(e->'prediction'->'predictions') = 'array'
            THEN jsonb_array_length(e->'prediction'->'predictions')
            ELSE 0
          END
        ), 0)
        FROM jsonb_array_elements(
          COALESCE(p.stage3_result_payload->'results', '[]'::jsonb)
        ) AS e
      ) AS run_detections
      FROM prediction_pipeline_runs p
      WHERE p.user_id = ${userId}
        AND p.status = 'finished'
        AND p.stage3_status = 'finished'
    ) t
  `;
  const speciesDetectionsCount =
    (speciesRows[0] as { c: number } | undefined)?.c ?? 0;

  return {
    totalPredictions,
    fecalDetectedStage1,
    helminthPositivePhase2,
    speciesDetectionsCount,
  };
}
