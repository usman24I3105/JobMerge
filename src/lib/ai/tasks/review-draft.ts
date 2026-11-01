/**
 * Drafter + Reviewer pipeline (ported from ai-job-search).
 *
 * When enabled (settings.useReviewerPipeline), any document generation
 * (tailor-resume, write-cover-letter) runs a second independent AI call that:
 *   1. Critiques the draft for keyword gaps, weak framing, unsupported claims
 *   2. Revises the draft based on the critique before the user sees it
 *
 * This is implemented as a higher-order wrapper: pass any Task in, get a
 * pipeline Task out.  The wrapper is transparent to the rest of the app.
 */

import { z } from "zod";

import type { Extracted, Match, Unit } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";

import { system, UNTRUSTED_POSTING, NO_EM_DASHES, type Task } from "./prompt-parts";

export const REVIEW_DRAFT_VERSION = "review-draft@1";

// ─── Reviewer call ────────────────────────────────────────────────────────────

const reviewSchema = z.object({
  keywordGaps: z.array(z.string()).describe("Keywords from the job posting that are missing or underrepresented in the draft"),
  weakFraming: z.array(z.string()).describe("Bullets or sentences that could be reframed to better match the job"),
  unsupportedClaims: z.array(z.string()).describe("Any claims not clearly backed by the candidate profile"),
  overallAssessment: z.string().describe("1-2 sentence summary of the draft's strength against this specific posting"),
  revisionPriorities: z.array(z.string()).describe("The top 3-5 specific changes that would most improve the draft"),
});

export type DraftReview = z.infer<typeof reviewSchema>;

const REVIEWER_INSTRUCTIONS = `You are a senior technical recruiter reviewing a draft resume or cover letter.
Your job is to critique the draft ONLY against this specific job posting.

Focus on:
- Keywords from the posting that are missing or underrepresented
- Bullets/sentences using weak verbs or generic framing when the posting asks for specifics
- Claims the candidate profile does not clearly support
- Missed opportunities where the candidate's experience maps to the posting but isn't surfaced

Be specific and actionable. Quote the draft text and the posting requirement when pointing out gaps.
Do NOT suggest adding fabricated experience or skills not in the profile.`;

// ─── Reviser call ────────────────────────────────────────────────────────────

const REVISER_INSTRUCTIONS = `You revise a resume or cover letter draft based on a critique, as JSON matching the original format.

Rules:
- Only use facts from the candidate's profile — never invent experience
- Apply each revision priority where the profile genuinely supports it
- Keep unchanged sections exactly as-is
- The revised output MUST match the original JSON schema`;

// ─── Pipeline wrapper ─────────────────────────────────────────────────────────

export type ReviewedInput<T> = T & {
  posting: string;
};

/**
 * Wraps any document-generation Task with a critic + revise second pass.
 *
 * Usage:
 *   const pipeline = withReview(tailorResume);
 *   const result = await pipeline(provider, input, options);
 */
export function withReview<TInput extends { profile: ProfileData; extracted: Extracted; match: Match | null; posting: string }, TOutput>(
  draft: Task<TInput, TOutput>,
): Task<TInput, TOutput & { review?: DraftReview }> {
  return async (provider, input, options) => {
    // Step 1: Generate the initial draft
    const draftResult = await draft(provider, input, options);

    // Step 2: Critique the draft
    let review: DraftReview | undefined;
    try {
      const critique = await provider.complete({
        system: system(
          REVIEWER_INSTRUCTIONS,
          UNTRUSTED_POSTING,
        ),
        messages: [
          {
            role: "user",
            content: [
              `The job posting:\n${input.extracted.text ?? input.posting}`,
              `The candidate profile summary:\n${input.profile.basics.headline || ""}\n${input.profile.basics.summary || ""}`,
              `The draft document (JSON):\n${JSON.stringify(draftResult.data, null, 2)}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        schema: reviewSchema,
        schemaName: "draft_review",
        creativity: "faithful",
        signal: options.signal,
      });
      review = critique;
    } catch {
      // Reviewer failure is non-fatal — return the draft as-is
      return { ...draftResult, review: undefined };
    }

    // If no revision priorities, the draft is already strong
    if (!review.revisionPriorities.length) {
      return { ...draftResult, review };
    }

    // Step 3: Revise the draft based on the critique
    try {
      const revisedResult = await draft(provider, {
        ...input,
        // Inject the critique as additional context via facts
        facts: [
          ...(input as unknown as { facts?: string[] }).facts ?? [],
          `Reviewer critique — apply these improvements (only where the profile supports it):\n${review.revisionPriorities.map((p, i) => `${i + 1}. ${p}`).join("\n")}`,
        ],
      } as TInput, options);

      return { ...revisedResult, review };
    } catch {
      // Revision failure — return original draft with the review attached
      return { ...draftResult, review };
    }
  };
}
