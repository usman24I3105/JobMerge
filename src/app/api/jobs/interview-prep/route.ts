/**
 * POST /api/jobs/interview-prep
 *
 * Generates an interview prep pack for a specific application.
 * Uses the exact resume and cover letter units that were submitted.
 *
 * Body: { applicationId: string; stage?: InterviewStage }
 * Returns: InterviewPrep JSON (streaming-compatible)
 */

import "server-only";

import { NextResponse } from "next/server";

import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { generateInterviewPrep, type InterviewStage } from "@/lib/ai/tasks/interview-prep";
import { loadDocuments } from "@/lib/application-documents";
import { getSession } from "@/lib/auth/session";

const VALID_STAGES: InterviewStage[] = ["screening", "first_round", "technical", "final", "general"];

export async function POST(request: Request) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { applicationId?: string; stage?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { applicationId, stage = "general" } = body;
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }
  if (!VALID_STAGES.includes(stage as InterviewStage)) {
    return NextResponse.json({ error: `stage must be one of: ${VALID_STAGES.join(", ")}` }, { status: 400 });
  }

  let docs: Awaited<ReturnType<typeof loadDocuments>>;
  try {
    docs = await loadDocuments(applicationId);
  } catch {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const { application, profile, resume, letter } = docs;
  let provider;
  let taskOptions;
  try {
    [provider, taskOptions] = await Promise.all([getAiProvider(), loadTaskOptions()]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI provider not configured";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  const prep = await generateInterviewPrep(provider, {
    profile,
    postingText: application.postingText,
    company: application.company,
    role: application.role || application.title,
    stage: stage as InterviewStage,
    resumeUnits: resume?.units ?? [],
    letterUnits: letter?.units ?? [],
    facts: application.facts.map((f) => f.text),
  }, {
    ...taskOptions,
    signal: AbortSignal.timeout(120_000),
  });

  return NextResponse.json(prep.data);
}
