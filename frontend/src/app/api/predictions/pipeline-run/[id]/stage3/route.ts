import { NextResponse } from "next/server";
import { resolvePredictionUserId } from "@/lib/prediction-api-auth";
import { serviceStartPipelineStage3 } from "@/lib/server/pipeline-run-service";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

function stage3StartErrorStatus(error: string): number {
  if (error === "Not found.") return 404;
  if (
    error === "Empty file." ||
    error.startsWith("File too large") ||
    error.startsWith("Unsupported image type") ||
    error === "Missing image file (form field: image)."
  ) {
    return 400;
  }
  if (
    error.includes("not in processing state") ||
    error.includes("already finished") ||
    error.includes("was skipped") ||
    error.includes("is not complete yet") ||
    error.includes("did not detect helminths")
  ) {
    return 409;
  }
  if (error.includes("Database is not configured")) return 503;
  if (
    error.includes("Remote status HTTP") ||
    error.includes("Could not reach") ||
    error.includes("Batch HTTP")
  ) {
    return 502;
  }
  return 500;
}

export async function POST(request: Request, context: RouteParams) {
  try {
    const { userId } = await resolvePredictionUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const image = formData.get("image");
    if (!image || !(image instanceof File)) {
      return NextResponse.json(
        { error: "Missing image file (form field: image)." },
        { status: 400 },
      );
    }

    const { id } = await context.params;
    const result = await serviceStartPipelineStage3(userId, id, image);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: stage3StartErrorStatus(result.error) },
      );
    }

    return NextResponse.json(result);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Server error";
    if (message.includes("DATABASE_URL")) {
      return NextResponse.json(
        { error: "Database is not configured (DATABASE_URL)." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
