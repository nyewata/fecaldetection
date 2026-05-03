/**
 * Server-only: HTTP base for forwarding batch + status to the helminth API.
 * Model list is fixed here so clients cannot request arbitrary .keras paths.
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

export const HELMINTH_MODEL_INPUT_SIZE = 224;
export const STAGE1_MODEL_INPUT_SIZE = 224;
export const STAGE2_MODEL_INPUT_SIZE = 224;

/** Backward compatibility for older Stage-2-only flows. */
export const HELMINTH_MODEL_FILENAMES = STAGE2_MODEL_FILENAMES;

export function getHelminthApiBaseUrl(): string {
  const base =
    process.env.HELMINTH_API_BASE_URL?.replace(/\/$/, "") ??
    "https://binaryapi.helminthdetect.app";
  return base;
}
