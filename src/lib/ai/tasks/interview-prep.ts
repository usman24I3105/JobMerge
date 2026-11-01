/**
 * Interview Prep AI task (ported/inspired by ai-job-search interview prep workflow).
 *
 * Generates a stage-specific interview prep pack:
 *   1. Company research summary (what they do, recent news, culture signals)
 *   2. Likely interview questions mapped to the exact CV/cover letter submitted
 *   3. STAR-format answers drawn from the candidate's profile and documents
 *   4. Questions to ask the interviewer
 *   5. Mock interview chat mode (separate stream)
 */

import { z } from "zod";

import type { Unit } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";

import { system, candidateFacts, UNTRUSTED_POSTING, NO_EM_DASHES, type Task } from "./prompt-parts";

export const INTERVIEW_PREP_VERSION = "interview-prep@1";

export type InterviewStage = "screening" | "first_round" | "technical" | "final" | "general";

// ─── Schema ───────────────────────────────────────────────────────────────────

const starAnswerSchema = z.object({
  question: z.string(),
  situation: z.string().describe("Specific situation or context from the candidate's experience"),
  task: z.string().describe("What the candidate was responsible for"),
  action: z.string().describe("Specific actions the candidate took — use facts from the profile only"),
  result: z.string().describe("Quantified outcome where possible; honest about gaps"),
  talkingPoints: z.array(z.string()).describe("3-5 key phrases to remember when answering"),
});

export const interviewPrepSchema = z.object({
  companySnapshot: z.object({
    whatTheyDo: z.string(),
    recentSignals: z.array(z.string()).describe("Recent news, funding, product launches if known from the posting"),
    cultureSignals: z.array(z.string()).describe("Culture, values, working style signals from the posting"),
    redFlags: z.array(z.string()).describe("Potential concerns to probe during the interview"),
  }),
  likelyQuestions: z.array(starAnswerSchema).describe("6-10 likely interview questions with STAR answers"),
  questionsToAsk: z.array(z.string()).describe("5-7 smart questions for the candidate to ask"),
  openingStatement: z.string().describe("A 90-second 'Tell me about yourself' answer tailored to this role"),
  keyThemes: z.array(z.string()).describe("3-5 themes to weave through every answer"),
});

export type InterviewPrep = z.infer<typeof interviewPrepSchema>;

// ─── Task ─────────────────────────────────────────────────────────────────────

const stageDescriptions: Record<InterviewStage, string> = {
  screening: "HR/recruiter phone screen — focus on fit, salary, availability, and high-level background",
  first_round: "First substantive interview — likely with the hiring manager or team lead",
  technical: "Technical interview — deep-dive on skills, problem-solving, and past technical decisions",
  final: "Final round — culture fit, strategic thinking, senior stakeholders, offer negotiation readiness",
  general: "General interview preparation — cover all stages",
};

const INSTRUCTIONS = `You prepare a candidate for a specific job interview, as JSON.

Your output MUST be grounded in:
  1. The candidate's actual profile and submitted documents (resume units, cover letter)
  2. The job posting text
  3. The interview stage

Rules:
- STAR answers MUST cite specific experiences from the profile — never invent
- Where the profile has a gap the question would surface, acknowledge it honestly and frame it as growth
- Company research is based ONLY on signals in the posting text (do not hallucinate news or facts)
- Questions to ask must be substantive — no generic "what does success look like" filler
- The opening statement should be 90 seconds when spoken at a normal pace`;

export type InterviewPrepInput = {
  profile: ProfileData;
  postingText: string;
  company: string;
  role: string;
  stage: InterviewStage;
  /** The resume units as submitted */
  resumeUnits: Unit[];
  /** The cover letter units as submitted */
  letterUnits: Unit[];
  facts: string[];
};

function unitsToText(units: Unit[]): string {
  return units
    .filter((u) => u.text.trim())
    .map((u) => `[${u.label}]\n${u.text}`)
    .join("\n\n");
}

export const generateInterviewPrep: Task<InterviewPrepInput, InterviewPrep> = async (
  provider,
  { profile, postingText, company, role, stage, resumeUnits, letterUnits, facts },
  options
) => {
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS,
      `Interview stage: ${stageDescriptions[stage]}`,
      candidateFacts(profile, facts),
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `Company: ${company}\nRole: ${role}`,
          `The job posting:\n${postingText}`,
          `Submitted resume:\n${unitsToText(resumeUnits)}`,
          `Submitted cover letter:\n${unitsToText(letterUnits)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: interviewPrepSchema,
    schemaName: "interview_prep",
    creativity: options.creativity,
    signal: options.signal,
  });

  return {
    data: answer,
    promptVersion: INTERVIEW_PREP_VERSION,
  };
};

// ─── Mock interview chat message schema ───────────────────────────────────────

export const mockInterviewSchema = z.object({
  question: z.string().describe("The interviewer's next question"),
  hint: z.string().optional().describe("A coaching hint about what to focus on in the answer"),
  followUp: z.boolean().describe("true if this is a follow-up to the previous answer"),
});

export type MockInterviewTurn = z.infer<typeof mockInterviewSchema>;

const MOCK_INSTRUCTIONS = `You are conducting a realistic job interview for the role described. 
Ask one question at a time. After the candidate answers, give brief coaching feedback (1-2 sentences) then ask the next question.
Base questions on the job posting and candidate's background. Mix behavioral, situational, and role-specific questions.
Do NOT break character or acknowledge you are an AI.`;

export const mockInterviewQuestion: Task<{ postingText: string; company: string; role: string; stage: InterviewStage; conversationHistory: Array<{ role: "interviewer" | "candidate"; text: string }> }, MockInterviewTurn> = async (
  provider,
  { postingText, company, role, stage, conversationHistory },
  options
) => {
  const historyText = conversationHistory
    .map((turn) => `${turn.role === "interviewer" ? "Interviewer" : "You"}: ${turn.text}`)
    .join("\n\n");

  const answer = await provider.complete({
    system: system(
      MOCK_INSTRUCTIONS,
      `Company: ${company} | Role: ${role} | Stage: ${stageDescriptions[stage]}`,
      UNTRUSTED_POSTING,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The job posting:\n${postingText}`,
          historyText ? `Conversation so far:\n${historyText}` : "Start the interview now.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: mockInterviewSchema,
    schemaName: "mock_interview_turn",
    creativity: "balanced",
    signal: options.signal,
  });

  return { data: answer, promptVersion: INTERVIEW_PREP_VERSION };
};
