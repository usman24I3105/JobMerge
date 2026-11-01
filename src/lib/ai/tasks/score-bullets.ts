/**
 * Relevance-weighted bullet scoring for resume content cutting.
 *
 * When a resume risks exceeding one page, instead of cutting the oldest entries
 * first (Dossier's default), we score each bullet by:
 *   (a) relevance to the job posting keywords
 *   (b) uniqueness — bullets that repeat concepts score lower
 *
 * This is a pre-generation preprocessing step: after the AI writes the draft,
 * before the page-limit trimmer runs, we annotate each unit's bullets with
 * scores so the trimmer knows which to cut first.
 *
 * Port of the relevance-ranking concept from ai-job-search's CLAUDE.md
 * "Verification Checklist" and ranking approach.
 */

import type { Unit } from "@/lib/application-data";

export type ScoredBullet = {
  text: string;
  relevanceScore: number;
  uniquenessScore: number;
  combinedScore: number;
};

export type ScoredUnit = {
  id: string;
  label: string;
  bullets: ScoredBullet[];
  /** The unit text reconstructed by keeping only bullets above the cut threshold. */
  text: string;
};

// ─── Keyword extraction ───────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "and", "or", "in", "at", "to", "a", "an", "of", "for", "with",
  "is", "are", "we", "you", "your", "our", "will", "be", "on", "as",
  "have", "experience", "skills", "team", "work", "role", "position",
  "i", "my", "me", "by", "was", "led", "used", "built", "across",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .match(/\b[a-z][a-z\-.+#]{1,}\b/g)
    ?.filter((w) => !STOP_WORDS.has(w)) ?? [];
}

function extractKeywordSet(postingText: string): Set<string> {
  const tokens = tokenize(postingText);
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  // Top 60 keywords by frequency
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
  return new Set(sorted.map(([w]) => w));
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/** Relevance score: fraction of the bullet's tokens that appear in posting keywords. */
function scoreRelevance(bulletText: string, keywords: Set<string>): number {
  const tokens = tokenize(bulletText);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t) => keywords.has(t)).length;
  return hits / tokens.length;
}

/** Uniqueness score: 1.0 if completely novel, lower if tokens repeat bullets already seen. */
function scoreUniqueness(bulletText: string, seenTokens: Set<string>): number {
  const tokens = tokenize(bulletText);
  if (tokens.length === 0) return 0;
  const novel = tokens.filter((t) => !seenTokens.has(t)).length;
  return novel / tokens.length;
}

// ─── Main scoring function ────────────────────────────────────────────────────

/**
 * Score every bullet in the resume units against the job posting.
 * Returns units annotated with per-bullet scores.
 *
 * Only scores units that have multi-line bullet text (experience, projects).
 * Summary, skills, education, languages are passed through unchanged.
 */
export function scoreBullets(units: Unit[], postingText: string): ScoredUnit[] {
  const keywords = extractKeywordSet(postingText);
  const seenTokens = new Set<string>();

  return units.map((unit) => {
    const lines = unit.text.split("\n").map((l) => l.trim()).filter(Boolean);

    // Units with a single block of prose (summary, skills) — no scoring
    if (lines.length <= 1 || !unit.id.startsWith("experience:") && !unit.id.startsWith("project:")) {
      return {
        id: unit.id,
        label: unit.label,
        text: unit.text,
        bullets: lines.map((l) => ({
          text: l,
          relevanceScore: 1,
          uniquenessScore: 1,
          combinedScore: 1,
        })),
      };
    }

    const scored: ScoredBullet[] = lines.map((line) => {
      const rel = scoreRelevance(line, keywords);
      const uniq = scoreUniqueness(line, seenTokens);
      const combined = 0.65 * rel + 0.35 * uniq;

      // Mark line's tokens as seen
      tokenize(line).forEach((t) => seenTokens.add(t));

      return { text: line, relevanceScore: rel, uniquenessScore: uniq, combinedScore: combined };
    });

    return {
      id: unit.id,
      label: unit.label,
      text: unit.text,
      bullets: scored,
    };
  });
}

/**
 * Cut bullets from scored units until the estimated word count target is met.
 * Cuts lowest-scoring bullets first (not oldest entries first).
 *
 * @param scored   - Output of scoreBullets()
 * @param targetWords - Approximate word count to cut down to (rough 1-page estimate)
 * @returns Units with text rebuilt from kept bullets
 */
export function cutToTarget(scored: ScoredUnit[], targetWords: number): { units: ScoredUnit[]; cutCount: number } {
  // Collect all bullets from cuttable units, sorted by combined score ascending (worst first)
  type CuttableRef = { unitIdx: number; bulletIdx: number; score: number };
  const cuttable: CuttableRef[] = [];

  scored.forEach((unit, ui) => {
    if (!unit.id.startsWith("experience:") && !unit.id.startsWith("project:")) return;
    unit.bullets.forEach((b, bi) => {
      // Always keep at least 1 bullet per unit; mark extras as cuttable
      if (bi > 0) {
        cuttable.push({ unitIdx: ui, bulletIdx: bi, score: b.combinedScore });
      }
    });
  });

  // Sort worst → best so we cut from the front
  cuttable.sort((a, b) => a.score - b.score);

  // Count current words
  const countWords = (units: ScoredUnit[]) =>
    units.reduce((acc, u) => acc + u.bullets.filter((b) => !(b as ScoredBullet & { _cut?: boolean })._cut).map((b) => b.text).join(" ").split(/\s+/).length, 0);

  const mutable = scored.map((u) => ({ ...u, bullets: u.bullets.map((b) => ({ ...b, _cut: false })) }));
  let cutCount = 0;

  for (const ref of cuttable) {
    if (countWords(mutable as unknown as ScoredUnit[]) <= targetWords) break;
    (mutable[ref.unitIdx].bullets[ref.bulletIdx] as ScoredBullet & { _cut: boolean })._cut = true;
    cutCount++;
  }

  const result = mutable.map((unit) => {
    const keptBullets = unit.bullets.filter((b) => !(b as ScoredBullet & { _cut?: boolean })._cut);
    return {
      ...unit,
      bullets: keptBullets,
      text: keptBullets.map((b) => b.text).join("\n"),
    };
  });

  return { units: result as ScoredUnit[], cutCount };
}
