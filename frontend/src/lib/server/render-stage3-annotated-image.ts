import {
  DETECTION_PALETTE,
  paletteIndexForClass,
} from "@/lib/detection-palette";
import type { HelminthStatusPayload } from "@/lib/helminth-remote";
import sharp from "sharp";

function svgEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type FlatBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  legendKey: string;
  stroke: string;
  fill: string;
  badge: string;
};

function flattenBoxes(remote: HelminthStatusPayload): FlatBox[] {
  const results = remote.results;
  if (!Array.isArray(results)) return [];
  const out: FlatBox[] = [];
  let seq = 0;
  for (const raw of results as Array<Record<string, unknown>>) {
    const pred = raw.prediction as
      | {
          predictions?: Array<{
            class_id?: unknown;
            class_name?: string;
            confidence?: number;
            box?: number[];
          }>;
        }
      | undefined;
    const preds = pred?.predictions;
    if (!Array.isArray(preds)) continue;
    for (const p of preds) {
      const box = p.box;
      if (!Array.isArray(box) || box.length < 4) continue;
      const [x1, y1, x2, y2] = box.map(Number) as [number, number, number, number];
      if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) continue;
      const classId = typeof p.class_id === "number" ? p.class_id : undefined;
      const className = String(p.class_name ?? "");
      const pi = paletteIndexForClass(classId, className);
      const pal = DETECTION_PALETTE[pi]!;
      seq += 1;
      out.push({
        x1,
        y1,
        x2,
        y2,
        legendKey: String(seq),
        stroke: pal.border,
        fill: `${pal.border}22`,
        badge: pal.badge,
      });
    }
  }
  return out;
}

/** Composite bounding boxes onto the original image; returns null if nothing to draw. */
export async function renderStage3AnnotatedPng(params: {
  imageBuf: Buffer;
  remote: HelminthStatusPayload;
}): Promise<Buffer | null> {
  const boxes = flattenBoxes(params.remote);
  if (boxes.length === 0) return null;

  const meta = await sharp(params.imageBuf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= 0 || h <= 0) return null;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
  ];
  for (const b of boxes) {
    const bw = Math.max(0, b.x2 - b.x1);
    const bh = Math.max(0, b.y2 - b.y1);
    const label = svgEscape(b.legendKey);
    const badgeW = Math.max(18, 8 + label.length * 7);
    const badgeH = 18;
    parts.push(
      `<rect x="${b.x1}" y="${b.y1}" width="${bw}" height="${bh}" fill="${b.fill}" stroke="${b.stroke}" stroke-width="2"/>`,
      `<rect x="${b.x1}" y="${b.y1}" width="${badgeW}" height="${badgeH}" fill="${b.badge}"/>`,
      `<text x="${b.x1 + 4}" y="${b.y1 + 13}" fill="white" font-size="11" font-family="ui-monospace, monospace" font-weight="bold">${label}</text>`,
    );
  }
  parts.push("</svg>");
  const svg = parts.join("");

  return sharp(params.imageBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 8 })
    .toBuffer();
}
