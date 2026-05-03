/**
 * Server-only: HTTP bases for forwarding batch + status to remote APIs.
 * Model lists are fixed here so clients cannot request arbitrary paths.
 */
export const STAGE1_MODEL_FILENAMES = [
  "BINARY_ConvNeXtBase_Round1.keras",
  "BINARY_DenseNet169_Round1.keras",
  "BINARY_EfficientNetB0_Round1.keras",
  "BINARY_MobileNetV2_Round5.keras",
  "BINARY_NASNetMobile_Round1.keras",
  "BINARY_ResNet50_Round2.keras",
  "BINARY_VGG19_Round4.keras",
] as const;

export const STAGE2_MODEL_FILENAMES = [
  "HELMINTHS_BINARY_DenseNet169_Round1.keras",
  "HELMINTHS_BINARY_ConvNeXtBase_Round2.keras",
  "HELMINTHS_BINARY_EfficientNetB0_Round1.keras",
  "HELMINTHS_BINARY_MobileNetV2_Round5.keras",
  "HELMINTHS_BINARY_NASNetMobile_Round4.keras",
  "HELMINTHS_BINARY_ResNet50_Round1.keras",
  "HELMINTHS_BINARY_VGG19_Round2.keras",
] as const;

/** Stage 3 multiclass detection (Ultralytics .pt on dedicated API). */
export const STAGE3_MODEL_FILENAMES = [
  "multiclass_helminths_rtdetr_l_round_1_best.pt",
] as const;

export const HELMINTH_MODEL_INPUT_SIZE = 224;
export const STAGE1_MODEL_INPUT_SIZE = 224;
export const STAGE2_MODEL_INPUT_SIZE = 224;
export const STAGE3_MODEL_INPUT_SIZE = 224;

/** Backward compatibility for older Stage-2-only flows. */
export const HELMINTH_MODEL_FILENAMES = STAGE2_MODEL_FILENAMES;

/** Stage 1 fecal gate (defaults to legacy `HELMINTH_API_BASE_URL`). */
export function getStage1ApiBaseUrl(): string {
  const base =
    process.env.STAGE1_API_BASE_URL?.replace(/\/$/, "") ??
    process.env.HELMINTH_API_BASE_URL?.replace(/\/$/, "") ??
    "https://binaryapi.helminthdetect.app";
  return base;
}

/** Stage 2 helminth binary screening. */
export function getStage2ApiBaseUrl(): string {
  const base =
    process.env.STAGE2_API_BASE_URL?.replace(/\/$/, "") ??
    "https://stage2api.helminthdetect.app";
  return base;
}

/** Stage 3 species detection (.pt models). */
export function getStage3ApiBaseUrl(): string {
  const base =
    process.env.STAGE3_API_BASE_URL?.replace(/\/$/, "") ??
    "https://stage3api.helminthdetect.app";
  return base;
}

/** @deprecated Prefer getStage1ApiBaseUrl — same intent as legacy env name. */
export function getHelminthApiBaseUrl(): string {
  return getStage1ApiBaseUrl();
}

function trimTrailingSlash(s: string): string {
  return s.replace(/\/$/, "");
}

/** Browser: WebSocket origin for Stage 1 remote job. */
export function getStage1WsOriginForClient(): string {
  return trimTrailingSlash(
    process.env.NEXT_PUBLIC_STAGE1_WS_ORIGIN ?? "wss://binaryapi.helminthdetect.app",
  );
}

/** Browser: WebSocket origin for Stage 2 remote job. */
export function getStage2WsOriginForClient(): string {
  return trimTrailingSlash(
    process.env.NEXT_PUBLIC_STAGE2_WS_ORIGIN ?? "wss://stage2api.helminthdetect.app",
  );
}

/** Browser: WebSocket origin for Stage 3 remote job. */
export function getStage3WsOriginForClient(): string {
  return trimTrailingSlash(
    process.env.NEXT_PUBLIC_STAGE3_WS_ORIGIN ?? "wss://stage3api.helminthdetect.app",
  );
}
