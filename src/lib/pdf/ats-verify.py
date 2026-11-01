#!/usr/bin/env python3
"""
ATS text-layer verification for Dossier resume PDFs.
Ported from ai-job-search/tools/verify_pdf.py.

Called by the Next.js API route /api/pdf/ats-verify via subprocess.
Input (stdin): JSON {"pdf_path": "...", "job_keywords": ["...", ...], "contact_name": "...", "contact_email": "...", "contact_phone": "..."}
Output (stdout): JSON report (see atsReportSchema in src/lib/application-data.ts)
Exit 0 = success (report may still contain warnings); Exit 1 = fatal error
"""

import json
import re
import sys
import unicodedata
from pathlib import Path


def extract_text(pdf_path: str):
    """Extract text from PDF using pypdf (primary) or pdftotext (fallback)."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(pdf_path)
        pages = len(reader.pages)
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        if text.strip():
            return text, pages, "pypdf"
    except Exception:
        pass

    # Fallback: pdftotext
    import subprocess
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", pdf_path, "-"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", check=True
        )
        text = result.stdout
        info = subprocess.run(
            ["pdfinfo", pdf_path],
            capture_output=True, text=True, encoding="utf-8", check=True
        )
        m = re.search(r"^Pages:\s+(\d+)\s*$", info.stdout, re.MULTILINE)
        pages = int(m.group(1)) if m else 1
        return text, pages, "pdftotext"
    except Exception as e:
        raise RuntimeError(f"Cannot extract text from PDF: {e}")


TYPOGRAPHIC_FOLDS = str.maketrans({
    "\u2018": "'", "\u2019": "'",
    "\u201c": '"', "\u201d": '"',
    "\u2013": "-", "\u2014": "-",
    "\u00a0": " ",
})


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text).translate(TYPOGRAPHIC_FOLDS)
    return " ".join(text.split()).lower()


# Garbled character patterns (cid references, replacement chars)
GARBLED = re.compile(r"\(cid:\d+\)|[\ufffd\u25a0]{2,}")


def check_garbled(text: str) -> list[str]:
    """Return garbled character instances found in the text."""
    return [m.group(0)[:40] for m in GARBLED.finditer(text)][:10]


def check_contact(text: str, name: str, email: str, phone: str) -> dict:
    """Verify contact details appear as literal text."""
    norm = normalize(text)
    issues = []
    found = {}

    if name:
        found["name"] = normalize(name) in norm
        if not found["name"]:
            issues.append(f"Name '{name}' not found in text layer")
    else:
        found["name"] = True

    if email:
        found["email"] = email.lower() in text.lower()
        if not found["email"]:
            issues.append(f"Email '{email}' not found in text layer")
    else:
        found["email"] = True

    if phone:
        # Strip formatting for comparison
        clean_phone = re.sub(r"[\s\-().+]", "", phone)
        clean_text = re.sub(r"[\s\-().+]", "", text)
        found["phone"] = clean_phone in clean_text
        if not found["phone"]:
            issues.append(f"Phone '{phone}' not found in text layer")
    else:
        found["phone"] = True

    return {"found": found, "issues": issues}


def check_reading_order(text: str) -> dict:
    """Heuristic: check if the text reads in a sane top-to-bottom order."""
    lines = [l for l in text.split("\n") if l.strip()]
    # Look for obvious scrambling: very short fragments alternating with long ones
    short_count = sum(1 for l in lines if len(l.strip()) < 5)
    total = len(lines)
    scramble_ratio = short_count / total if total else 0
    sane = scramble_ratio < 0.4
    return {
        "sane": sane,
        "scramble_ratio": round(scramble_ratio, 3),
        "note": "High ratio of very short lines may indicate multi-column layout scrambling" if not sane else "OK",
    }


def check_keywords(text: str, keywords: list[str]) -> dict:
    """Report keyword coverage against the job posting."""
    norm = normalize(text)
    covered = []
    missing = []
    for kw in keywords:
        if normalize(kw) in norm:
            covered.append(kw)
        else:
            missing.append(kw)
    coverage = len(covered) / len(keywords) if keywords else 1.0
    return {
        "covered": covered,
        "missing": missing,
        "coverage_pct": round(coverage * 100, 1),
    }


def main():
    try:
        inp = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        sys.exit(1)

    pdf_path = inp.get("pdf_path", "")
    job_keywords = inp.get("job_keywords", [])
    contact_name = inp.get("contact_name", "")
    contact_email = inp.get("contact_email", "")
    contact_phone = inp.get("contact_phone", "")

    if not pdf_path or not Path(pdf_path).is_file():
        print(json.dumps({"error": f"PDF not found: {pdf_path}"}))
        sys.exit(1)

    try:
        text, pages, extractor = extract_text(pdf_path)
    except RuntimeError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    garbled = check_garbled(text)
    contact = check_contact(text, contact_name, contact_email, contact_phone)
    reading_order = check_reading_order(text)
    keywords = check_keywords(text, job_keywords)

    # Overall pass/fail
    passed = (
        not garbled
        and all(contact["found"].values())
        and reading_order["sane"]
        and keywords["coverage_pct"] >= 50
    )

    report = {
        "extractor": extractor,
        "pages": pages,
        "passed": passed,
        "garbled_chars": garbled,
        "contact": contact,
        "reading_order": reading_order,
        "keywords": keywords,
        "text_length": len(text),
        "warnings": (
            (["Garbled characters found — ATS may misread the resume"] if garbled else []) +
            contact["issues"] +
            (["Reading order may be scrambled (multi-column layout)"] if not reading_order["sane"] else []) +
            ([f"Only {keywords['coverage_pct']}% keyword coverage — consider adding: {', '.join(keywords['missing'][:5])}"] if keywords["coverage_pct"] < 50 else [])
        ),
    }

    print(json.dumps(report, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
