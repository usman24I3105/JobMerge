/**
 * Posting integrity gate — TypeScript port of ai-job-search/tools/posting_guard.py.
 *
 * Before processing any job posting URL or pasted text, run a check for:
 *   - Hidden characters (zero-width, bidi controls, Unicode tag chars)
 *   - Instruction-shaped lines aimed at an AI agent (prompt injection)
 *   - Mixed-script words (homoglyph/look-alike spoofing)
 *
 * Returns a PostingGuardResult: { clean: boolean; verdict: string; findings: {...} }
 * The caller decides whether to reject or warn.
 */

import "server-only";

export type PostingGuardFindings = {
  instructionLike: string[];
  invisibleFlagged: number;
  invisibleCounts: Record<string, number>;
  invisibleText: string[];
  homoglyphWords: string[];
  hiddenBlocks: string[];
  tagChars: number;
};

export type PostingGuardResult = {
  /** true = no alarms; false = suspicious patterns found */
  clean: boolean;
  /** Human-readable verdict line */
  verdict: string;
  /** Cleaned text with invisible chars removed */
  cleanedText: string;
  findings: PostingGuardFindings;
};

// ─── Character sets ───────────────────────────────────────────────────────────

const ZERO_WIDTH = "\u200B\u200C\u200D\u2060\u2061\u2062\u2063\u2064";
const BIDI = "\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069";
const BIDI_TAMPER = "\u202D\u202E\u2066\u2067\u2068\u2069"; // overrides and isolates
const BOM = "\uFEFF";
const SOFT_HYPHEN = "\u00AD";

// Unicode tag block U+E0000–U+E007F: invisible ASCII lookalikes
function hasTagChars(text: string): { count: number; decoded: string[] } {
  const decoded: string[] = [];
  let run = "";
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xe0020 && cp < 0xe007f) {
      run += String.fromCodePoint(cp - 0xe0000);
      count++;
    } else {
      if (run.trim()) decoded.push(run.trim());
      run = "";
    }
  }
  if (run.trim()) decoded.push(run.trim());
  return { count, decoded };
}

// ─── Instruction patterns ─────────────────────────────────────────────────────

const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore (all|any|the|previous|prior|above|earlier)\b/i,
  /\b(disregard|forget)( all| any| the| your| my)? (previous|prior|above|earlier|preceding|initial|original|system) (instructions?|prompts?)\b/i,
  /\byou are (?:an?|the) (?:ai(?![\w-])|ai (?:assistant|agent|model|language model)|assistant|llm|language model)\b/i,
  /\bsystem prompt\b/i,
  /\b(do not|don['']?t|never) (tell|inform) the user\b(?!['']s)/i,
  /\b(do not|don['']?t|never) (mention|reveal|disclose) (this|these|that|it|any of this|the (above|following|previous))\b.{0,30}\bto the user\b/i,
  /\b(run|execute) the following (command|commands|script|code|shell|instruction|instructions|steps)\b/i,
  /^\s*(assistant|system|user)\s*:/im,
  /<\|/,
  /\[INST\]/,
  /###\s*(system|instruction)/i,
  /\b(curl|wget|ssh|scp)\b/,
  /\.env\b/,
  /settings\.json/,
  /allowed-tools/,
  /\btool_use\b|\bfunction_call\b/,
];

// ─── Homoglyph detection ──────────────────────────────────────────────────────

// Cyrillic and Greek chars that look like Latin letters
const CONFUSABLE = /[\u0400-\u04FF\u0370-\u03FF]/;
const LATIN = /[A-Za-z]/;
const WORD_RE = /\w+/gu;

function findHomoglyphs(text: string): string[] {
  const words: string[] = [];
  for (const match of text.matchAll(WORD_RE)) {
    const w = match[0];
    if (LATIN.test(w) && CONFUSABLE.test(w)) words.push(w);
  }
  return [...new Set(words)];
}

// ─── Invisible character removal ──────────────────────────────────────────────

function cleanInvisible(text: string): {
  cleaned: string;
  counts: Record<string, number>;
  flagged: number;
  invisibleText: string[];
} {
  const counts: Record<string, number> = {};
  let flagged = 0;

  const zeroWidthCount = [...ZERO_WIDTH].reduce((n, c) => n + (text.split(c).length - 1), 0);
  if (zeroWidthCount) counts["zero_width"] = zeroWidthCount;

  const bidiCount = [...BIDI].reduce((n, c) => n + (text.split(c).length - 1), 0);
  if (bidiCount) counts["bidi"] = bidiCount;

  const { count: tagCount, decoded: tagDecoded } = hasTagChars(text);
  if (tagCount) counts["tag"] = tagCount;

  const bomCount = (text.split(BOM).length - 1);
  if (bomCount) counts["bom"] = bomCount;

  // Count tampered (bidi overrides inside words)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (BIDI_TAMPER.includes(ch)) {
      flagged++;
    } else if ((ZERO_WIDTH + BOM).includes(ch)) {
      const before = i > 0 ? text[i - 1] : "";
      const after = i + 1 < text.length ? text[i + 1] : "";
      if (/\w/.test(before) && /\w/.test(after)) flagged++;
    }
  }

  // Remove invisible chars
  const toRemove = new Set([...ZERO_WIDTH, ...BIDI, BOM, SOFT_HYPHEN]);
  let cleaned = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xe0000 && cp <= 0xe007f) continue; // tag chars
    if (toRemove.has(ch)) continue;
    cleaned += ch;
  }

  return { cleaned, counts, flagged, invisibleText: tagDecoded };
}

// ─── Main guard function ──────────────────────────────────────────────────────

/** Normalize whitespace */
function fold(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v\u00A0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Run the posting integrity gate.
 * @param rawText - The posting text (plain text or HTML stripped by caller)
 */
export function guardPosting(rawText: string): PostingGuardResult {
  // Step 1: Clean invisible characters
  const { cleaned: cleanedText, counts, flagged, invisibleText } = cleanInvisible(rawText);
  const folded = fold(cleanedText);

  // Step 2: Scan for instruction-shaped lines
  const seen = new Set<string>();
  const instructionLike: string[] = [];

  for (const line of folded.split("\n")) {
    const stripped = line.trim();
    if (!stripped || seen.has(stripped)) continue;
    const match = INSTRUCTION_PATTERNS.find((p) => p.test(stripped));
    if (match) {
      seen.add(stripped);
      instructionLike.push(stripped.slice(0, 200));
    }
  }

  // Step 3: Homoglyph detection
  const homoglyphWords = findHomoglyphs(folded);

  // Step 4: Build verdict
  const alarms: string[] = [];
  if (instructionLike.length) alarms.push(`${instructionLike.length} instruction-like line${instructionLike.length > 1 ? "s" : ""}`);
  if (flagged) alarms.push(`${flagged} suspicious invisible character${flagged > 1 ? "s" : ""}`);
  if (counts["tag"]) alarms.push(`${counts["tag"]} hidden tag character${counts["tag"] > 1 ? "s" : ""} (text hidden from reader)`);
  if (invisibleText.length) alarms.push(`${invisibleText.length} string${invisibleText.length > 1 ? "s" : ""} spelled in invisible characters`);
  if (homoglyphWords.length) alarms.push(`${homoglyphWords.length} mixed-script word${homoglyphWords.length > 1 ? "s" : ""}`);

  const clean = alarms.length === 0;
  const verdict = clean
    ? "posting_guard: clean"
    : `posting_guard: ⚠ ${alarms.join(", ")} — review before continuing`;

  return {
    clean,
    verdict,
    cleanedText: folded,
    findings: {
      instructionLike,
      invisibleFlagged: flagged,
      invisibleCounts: counts,
      invisibleText,
      homoglyphWords,
      hiddenBlocks: [], // HTML hidden-block detection not needed for plain text
      tagChars: counts["tag"] ?? 0,
    },
  };
}
