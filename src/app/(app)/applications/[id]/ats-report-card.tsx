"use client";

import { useState } from "react";
import { Dialog } from "radix-ui";
import type { AtsReport } from "@/lib/application-data";
import { Button } from "@/components/ui/button";

type Props = {
  applicationId: string;
  initialReport?: AtsReport | null;
};

export function AtsReportCard({ applicationId, initialReport }: Props) {
  const [report, setReport] = useState<AtsReport | null>(initialReport ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function runVerification() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pdf/ats-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to run ATS verification");
      }
      const data: AtsReport = await res.json();
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ATS check failed");
    } finally {
      setLoading(false);
    }
  }

  const keywordCoverage = report?.checks?.keyword_coverage as
    | { coverage_percent?: number; found_keywords?: string[]; missing_keywords?: string[] }
    | undefined;

  const contactCheck = report?.checks?.contact_details as
    | { passed?: boolean; found?: Record<string, string>; missing?: string[] }
    | undefined;

  const garbledCheck = report?.checks?.garbled_characters as
    | { passed?: boolean; garbled_percent?: number; sample_snippets?: string[] }
    | undefined;

  const readingOrder = report?.checks?.reading_order as
    | { passed?: boolean; sections_detected?: string[] }
    | undefined;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5 font-medium"
          id="ats-check-trigger-btn"
        >
          <span className="text-xs">⚡</span>
          <span>ATS Check</span>
          {report && (
            <span
              className={`ml-1 px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                report.passed
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              }`}
            >
              {keywordCoverage?.coverage_percent !== undefined
                ? `${Math.round(keywordCoverage.coverage_percent)}%`
                : report.passed
                ? "Pass"
                : "Review"}
            </span>
          )}
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-dialog border border-line-popover bg-card p-6 shadow-menu max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <Dialog.Title className="font-serif text-[20px] leading-tight">
              ATS Text-Layer Verification
            </Dialog.Title>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={report ? "secondary" : "primary"}
                onClick={runVerification}
                disabled={loading}
                id="ats-run-check-btn"
              >
                {loading ? "Analyzing PDF…" : report ? "Re-run Check" : "Run Check"}
              </Button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full p-1 text-muted hover:text-foreground text-sm leading-none"
                  aria-label="Close"
                >
                  ✕
                </button>
              </Dialog.Close>
            </div>
          </div>

          {error && (
            <div className="rounded-card bg-danger-surface p-3 text-sm text-danger border border-line">
              {error}
            </div>
          )}

          {!report && !loading && (
            <div className="py-6 text-center text-sm text-muted space-y-2">
              <p>Verify that your resume PDF renders cleanly for Applicant Tracking Systems.</p>
              <p className="text-xs">
                Checks: ungarbled text layer, parseable contact info, keyword coverage, and section reading order.
              </p>
            </div>
          )}

          {loading && (
            <div className="py-8 text-center space-y-3">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-current border-r-transparent align-[-0.125em]" />
              <p className="text-sm text-muted">
                Rendering PDF and verifying text layer with ATS parser…
              </p>
            </div>
          )}

          {report && (
            <div className="space-y-4 pt-1">
              {/* Top Score Banner */}
              <div
                className={`p-4 rounded-card border flex items-center justify-between ${
                  report.passed
                    ? "bg-emerald-500/10 border-emerald-500/25"
                    : "bg-warning-surface border-warning/30"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{report.passed ? "✅" : "⚠️"}</span>
                    <span className="font-semibold text-sm">
                      {report.passed ? "ATS Friendly · Passed" : "Action Recommended"}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    Verified with {report.extractor} · {report.pages} page{report.pages === 1 ? "" : "s"}
                  </p>
                </div>
                {keywordCoverage?.coverage_percent !== undefined && (
                  <div className="text-right">
                    <div className="text-2xl font-bold font-mono">
                      {Math.round(keywordCoverage.coverage_percent)}%
                    </div>
                    <div className="text-[11px] text-muted uppercase tracking-wider">
                      Keyword Match
                    </div>
                  </div>
                )}
              </div>

              {/* Check Breakdown Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                {/* Text Layer */}
                <div className="p-3 rounded-card border border-line bg-surface space-y-1">
                  <div className="flex items-center justify-between font-medium">
                    <span>Text Readability</span>
                    <span>{garbledCheck?.passed ? "✅ Clear" : "⚠️ Issues"}</span>
                  </div>
                  <p className="text-muted">
                    {garbledCheck?.garbled_percent !== undefined
                      ? `${(garbledCheck.garbled_percent * 100).toFixed(1)}% unusual chars`
                      : "Plain text layer extracted cleanly"}
                  </p>
                </div>

                {/* Contact Info */}
                <div className="p-3 rounded-card border border-line bg-surface space-y-1">
                  <div className="flex items-center justify-between font-medium">
                    <span>Contact Details</span>
                    <span>{contactCheck?.passed ? "✅ Complete" : "⚠️ Missing"}</span>
                  </div>
                  <p className="text-muted">
                    {contactCheck?.missing?.length
                      ? `Missing: ${contactCheck.missing.join(", ")}`
                      : "Name, email & phone found in text"}
                  </p>
                </div>

                {/* Reading Order */}
                <div className="p-3 rounded-card border border-line bg-surface space-y-1">
                  <div className="flex items-center justify-between font-medium">
                    <span>Reading Order</span>
                    <span>{readingOrder?.passed ? "✅ Sanity passed" : "ℹ️ Review"}</span>
                  </div>
                  <p className="text-muted">
                    {readingOrder?.sections_detected?.length
                      ? `${readingOrder.sections_detected.length} sections sequenced`
                      : "Standard document flow"}
                  </p>
                </div>

                {/* Keywords */}
                <div className="p-3 rounded-card border border-line bg-surface space-y-1">
                  <div className="flex items-center justify-between font-medium">
                    <span>Keywords</span>
                    <span>
                      {keywordCoverage?.found_keywords?.length ?? 0} found
                    </span>
                  </div>
                  <p className="text-muted">
                    {keywordCoverage?.missing_keywords?.length
                      ? `${keywordCoverage.missing_keywords.length} gaps identified`
                      : "High keyword alignment"}
                  </p>
                </div>
              </div>

              {/* Keyword gaps list */}
              {keywordCoverage?.missing_keywords && keywordCoverage.missing_keywords.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                    Top Missing Job Keywords
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {keywordCoverage.missing_keywords.slice(0, 10).map((kw, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded text-xs bg-track text-muted border border-line"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {report.recommendations && report.recommendations.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                    Recommendations
                  </span>
                  <ul className="text-xs space-y-1 text-muted list-disc list-inside">
                    {report.recommendations.map((rec, i) => (
                      <li key={i}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Warnings */}
              {report.warnings && report.warnings.length > 0 && (
                <div className="space-y-1">
                  {report.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-warning">
                      ⚠️ {w}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
