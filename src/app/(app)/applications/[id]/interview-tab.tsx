"use client";

/**
 * Interview Prep Tab — full UI for the interview preparation feature.
 *
 * Shows:
 *   - Stage selector (screening / first round / technical / final / general)
 *   - Company snapshot (what they do, culture signals, red flags)
 *   - STAR-format Q&A for likely questions
 *   - Questions to ask the interviewer
 *   - 90-second opening statement
 *   - Key themes to weave through answers
 *   - Mock interview chat mode
 */

import { useState, useRef } from "react";
import type { InterviewPrep, InterviewStage, MockInterviewTurn } from "@/lib/ai/tasks/interview-prep";

type Props = {
  applicationId: string;
  company: string;
  role: string;
};

const STAGES: { value: InterviewStage; label: string; emoji: string }[] = [
  { value: "screening", label: "HR Screening", emoji: "📞" },
  { value: "first_round", label: "First Round", emoji: "🤝" },
  { value: "technical", label: "Technical", emoji: "💻" },
  { value: "final", label: "Final Round", emoji: "🏁" },
  { value: "general", label: "General Prep", emoji: "📚" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StarCard({ item, index }: { item: InterviewPrep["likelyQuestions"][0]; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-[--color-border] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[--color-surface-hover] transition-colors"
        id={`interview-q-${index}`}
      >
        <span className="text-[--color-text-muted] font-mono text-sm w-5 shrink-0">{index + 1}.</span>
        <span className="font-medium text-sm">{item.question}</span>
        <span className="ml-auto text-[--color-text-muted]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-[--color-border] bg-[--color-surface]">
          <div className="grid grid-cols-1 gap-3 pt-3">
            {(["situation", "task", "action", "result"] as const).map((key) => (
              <div key={key} className="flex gap-3">
                <span className="text-xs font-bold uppercase text-[--color-accent] w-16 shrink-0 pt-0.5">
                  {key.charAt(0).toUpperCase()}
                </span>
                <p className="text-sm text-[--color-text]">{item[key]}</p>
              </div>
            ))}
          </div>
          {item.talkingPoints.length > 0 && (
            <div className="mt-3 p-3 rounded-md bg-[--color-surface-alt] border border-[--color-border]">
              <p className="text-xs font-semibold text-[--color-text-muted] mb-2">Key phrases to remember:</p>
              <ul className="space-y-1">
                {item.talkingPoints.map((tp, i) => (
                  <li key={i} className="text-sm flex gap-2">
                    <span className="text-[--color-accent]">•</span>
                    {tp}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MockInterviewChat({ applicationId, stage }: { applicationId: string; stage: InterviewStage }) {
  const [turns, setTurns] = useState<Array<{ role: "interviewer" | "candidate"; text: string; hint?: string }>>([]);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function fetchNextQuestion(history: Array<{ role: "interviewer" | "candidate"; text: string }>) {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs/mock-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, stage, conversationHistory: history }),
      });
      const data: MockInterviewTurn = await res.json();
      setTurns((prev) => [...prev, { role: "interviewer", text: data.question, hint: data.hint }]);
    } finally {
      setLoading(false);
    }
  }

  async function startInterview() {
    setStarted(true);
    await fetchNextQuestion([]);
  }

  async function submitAnswer() {
    if (!answer.trim()) return;
    const newTurn = { role: "candidate" as const, text: answer.trim() };
    const newTurns = [...turns, newTurn];
    setTurns(newTurns);
    setAnswer("");
    await fetchNextQuestion(newTurns.map(({ role, text }) => ({ role, text })));
  }

  if (!started) {
    return (
      <div className="text-center py-8">
        <p className="text-[--color-text-muted] text-sm mb-4">
          Start a mock interview session. The AI will ask you questions one at a time, give you feedback, and move through the conversation naturally.
        </p>
        <button
          type="button"
          onClick={startInterview}
          id="mock-interview-start"
          className="px-6 py-2.5 bg-[--color-accent] text-white rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
        >
          Start Mock Interview
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
        {turns.map((turn, i) => (
          <div key={i} className={`flex ${turn.role === "candidate" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                turn.role === "candidate"
                  ? "bg-[--color-accent] text-white rounded-br-sm"
                  : "bg-[--color-surface-alt] text-[--color-text] rounded-bl-sm border border-[--color-border]"
              }`}
            >
              {turn.role === "interviewer" && (
                <p className="text-xs font-semibold opacity-60 mb-1">Interviewer</p>
              )}
              <p>{turn.text}</p>
              {turn.hint && (
                <p className="mt-2 text-xs opacity-70 italic">💡 {turn.hint}</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[--color-surface-alt] border border-[--color-border] rounded-2xl rounded-bl-sm px-4 py-3">
              <span className="text-[--color-text-muted] text-sm">Thinking…</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          id="mock-interview-answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitAnswer(); } }}
          rows={2}
          placeholder="Your answer… (Enter to send, Shift+Enter for new line)"
          className="flex-1 resize-none rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-accent]"
          disabled={loading}
        />
        <button
          type="button"
          onClick={submitAnswer}
          id="mock-interview-send"
          disabled={loading || !answer.trim()}
          className="px-4 py-2 bg-[--color-accent] text-white rounded-lg font-medium text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function InterviewTab({ applicationId, company, role }: Props) {
  const [stage, setStage] = useState<InterviewStage>("general");
  const [prep, setPrep] = useState<InterviewPrep | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"prep" | "mock">("prep");

  async function generatePrep() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs/interview-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, stage }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to generate interview prep");
      }
      setPrep(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 py-4 px-1">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-[--color-text]">Interview Prep</h2>
          <p className="text-sm text-[--color-text-muted]">
            Powered by your submitted resume and cover letter for {company || "this company"}
          </p>
        </div>

        {/* Mode toggle */}
        {prep && (
          <div className="flex rounded-lg border border-[--color-border] overflow-hidden text-sm">
            <button
              type="button"
              id="interview-mode-prep"
              onClick={() => setMode("prep")}
              className={`px-4 py-1.5 font-medium transition-colors ${mode === "prep" ? "bg-[--color-accent] text-white" : "hover:bg-[--color-surface-hover]"}`}
            >
              Prep Pack
            </button>
            <button
              type="button"
              id="interview-mode-mock"
              onClick={() => setMode("mock")}
              className={`px-4 py-1.5 font-medium transition-colors ${mode === "mock" ? "bg-[--color-accent] text-white" : "hover:bg-[--color-surface-hover]"}`}
            >
              Mock Interview
            </button>
          </div>
        )}
      </div>

      {/* Stage selector + generate */}
      <div className="flex gap-2 flex-wrap">
        {STAGES.map((s) => (
          <button
            key={s.value}
            type="button"
            id={`interview-stage-${s.value}`}
            onClick={() => setStage(s.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              stage === s.value
                ? "bg-[--color-accent] text-white border-transparent"
                : "border-[--color-border] hover:bg-[--color-surface-hover]"
            }`}
          >
            <span>{s.emoji}</span>
            {s.label}
          </button>
        ))}
        <button
          type="button"
          id="generate-interview-prep"
          onClick={generatePrep}
          disabled={loading}
          className="ml-auto px-4 py-1.5 rounded-full text-sm font-medium bg-[--color-accent] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "Generating…" : prep ? "Regenerate" : "Generate Prep Pack"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !prep && (
        <div className="space-y-4 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-[--color-surface-alt]" />
          ))}
        </div>
      )}

      {/* Prep Pack */}
      {prep && mode === "prep" && (
        <div className="space-y-6">
          {/* Opening statement */}
          <section id="interview-opening-statement">
            <h3 className="text-sm font-semibold text-[--color-text] mb-2">🎤 Opening Statement (90 seconds)</h3>
            <div className="p-4 rounded-lg bg-[--color-surface-alt] border border-[--color-border] text-sm whitespace-pre-wrap">
              {prep.openingStatement}
            </div>
          </section>

          {/* Key themes */}
          <section>
            <h3 className="text-sm font-semibold text-[--color-text] mb-2">🔑 Key Themes to Weave In</h3>
            <div className="flex flex-wrap gap-2">
              {prep.keyThemes.map((theme, i) => (
                <span key={i} className="px-3 py-1 rounded-full bg-[--color-accent-subtle] text-[--color-accent] text-xs font-medium border border-[--color-accent-muted]">
                  {theme}
                </span>
              ))}
            </div>
          </section>

          {/* Company snapshot */}
          <section>
            <h3 className="text-sm font-semibold text-[--color-text] mb-3">🏢 Company Snapshot</h3>
            <div className="rounded-lg border border-[--color-border] overflow-hidden">
              <div className="p-4 space-y-3">
                <p className="text-sm">{prep.companySnapshot.whatTheyDo}</p>
                {prep.companySnapshot.cultureSignals.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[--color-text-muted] mb-1">Culture signals:</p>
                    <ul className="space-y-0.5">
                      {prep.companySnapshot.cultureSignals.map((s, i) => (
                        <li key={i} className="text-sm flex gap-2"><span className="text-green-500">✓</span>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {prep.companySnapshot.redFlags.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-[--color-text-muted] mb-1">Things to probe:</p>
                    <ul className="space-y-0.5">
                      {prep.companySnapshot.redFlags.map((f, i) => (
                        <li key={i} className="text-sm flex gap-2"><span className="text-amber-500">⚠</span>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Likely questions with STAR answers */}
          <section>
            <h3 className="text-sm font-semibold text-[--color-text] mb-3">❓ Likely Questions & STAR Answers</h3>
            <div className="space-y-2">
              {prep.likelyQuestions.map((item, i) => (
                <StarCard key={i} item={item} index={i} />
              ))}
            </div>
          </section>

          {/* Questions to ask */}
          <section>
            <h3 className="text-sm font-semibold text-[--color-text] mb-3">🙋 Questions to Ask Them</h3>
            <ol className="space-y-2">
              {prep.questionsToAsk.map((q, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="font-mono text-[--color-text-muted] shrink-0">{i + 1}.</span>
                  <span>{q}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}

      {/* Mock interview mode */}
      {prep && mode === "mock" && (
        <MockInterviewChat applicationId={applicationId} stage={stage} />
      )}
    </div>
  );
}
