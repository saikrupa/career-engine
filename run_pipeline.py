#!/usr/bin/env python3
"""
run_pipeline.py — one-command ATS job ingestion.

Usage
-----
  python run_pipeline.py                          # process companies.json
  python run_pipeline.py -c my_companies.json     # custom config
  python run_pipeline.py -k "android" -l "remote" # filter by keyword + location
  python run_pipeline.py --no-interactive          # skip prompts (CI/cron mode)
  python run_pipeline.py --dry-run                 # show companies list, no network calls
  make run                                         # same as first form above

Output
------
  - Live progress to stdout while running
  - Final summary table to stdout
  - Full results written to output/pipeline-YYYY-MM-DD.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

# Allow running from repo root without installing the package.
sys.path.insert(0, str(Path(__file__).parent))

from ats_ingestion.runner import run_pipeline

# ── ANSI colour helpers ──────────────────────────────────────────────────────
_RESET  = "\033[0m"
_BOLD   = "\033[1m"
_GREEN  = "\033[32m"
_YELLOW = "\033[33m"
_RED    = "\033[31m"
_CYAN   = "\033[36m"
_DIM    = "\033[2m"

def _c(text: str, colour: str) -> str:
    """Wrap text in ANSI colour codes (skipped when stdout is not a TTY)."""
    if not sys.stdout.isatty():
        return text
    return f"{colour}{text}{_RESET}"

# ── Config loader ────────────────────────────────────────────────────────────

def load_companies(path: str) -> list[dict]:
    config_path = Path(path)
    if not config_path.exists():
        print(_c(f"✗ Config file not found: {path}", _RED))
        sys.exit(1)

    suffix = config_path.suffix.lower()
    with config_path.open(encoding="utf-8") as fh:
        if suffix == ".json":
            data = json.load(fh)
        elif suffix in (".yml", ".yaml"):
            try:
                import yaml  # type: ignore
                data = yaml.safe_load(fh)
            except ImportError:
                print(_c("✗ PyYAML not installed. Run: pip install pyyaml", _RED))
                sys.exit(1)
        else:
            print(_c(f"✗ Unsupported config format: {suffix}. Use .json or .yaml", _RED))
            sys.exit(1)

    if not isinstance(data, list):
        print(_c("✗ Config must be a JSON/YAML array of company objects.", _RED))
        sys.exit(1)
    return data

# ── CLI ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="run_pipeline",
        description="One-command ATS job ingestion across all configured companies.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-c", "--config",
        default="companies.json",
        metavar="FILE",
        help="Company config file (JSON or YAML). Default: companies.json",
    )
    parser.add_argument(
        "-k", "--keyword",
        default="",
        metavar="WORD",
        help="Filter jobs by keyword in title (e.g. 'android')",
    )
    parser.add_argument(
        "-l", "--location",
        default="",
        metavar="PLACE",
        help="Filter jobs by location string (e.g. 'remote' or 'dallas')",
    )
    parser.add_argument(
        "--no-interactive",
        dest="interactive",
        action="store_false",
        default=True,
        help="Disable interactive prompts — useful for CI/cron runs",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the company list and exit without making any network calls",
    )
    parser.add_argument(
        "-o", "--output",
        default="",
        metavar="FILE",
        help="Write JSON results to this file (default: output/pipeline-YYYY-MM-DD.json)",
    )
    return parser.parse_args()

# ── Pretty progress ──────────────────────────────────────────────────────────

def _strategy_label(strategy: str) -> str:
    labels = {
        "connector":    _c("connector ✔", _GREEN),
        "html_ld_json": _c("ld+json scrape ✔", _YELLOW),
        "html_scrape":  _c("html scrape ✔", _YELLOW),
        "manual":       _c("manual entry ✔", _CYAN),
        "skipped":      _c("skipped ✗", _RED),
    }
    return labels.get(strategy, strategy)

def _ats_label(ats: str, confidence: float) -> str:
    if ats == "unknown":
        return _c("unknown", _DIM)
    return f"{_c(ats, _BOLD)} {_c(f'({confidence:.0%})', _DIM)}"


def print_header(total: int) -> None:
    print()
    print(_c("=" * 60, _BOLD))
    print(_c("  ATS Ingestion Pipeline", _BOLD))
    print(_c("=" * 60, _BOLD))
    print(f"  Companies: {total}")
    print()


def print_company_start(idx: int, total: int, name: str, url: str) -> None:
    print(f"  [{idx}/{total}] {_c(name, _BOLD)}")
    print(f"         {_c(url, _DIM)}")


def print_company_result(result: dict) -> None:
    strategy  = result.get("strategy", "")
    ats       = result.get("ats_type", "unknown")
    confidence = float(result.get("confidence") or 0)
    count     = result.get("count", 0)
    reason    = result.get("reason", "")

    ats_str = _ats_label(ats, confidence)
    strat   = _strategy_label(strategy)

    if strategy == "skipped":
        print(f"         → {strat}  {_c(reason, _DIM)}")
    else:
        print(f"         → {strat}  ATS: {ats_str}  Jobs: {_c(str(count), _BOLD)}")
    print()


def print_summary(results: list[dict], output_file: str, elapsed: float) -> None:
    ok      = [r for r in results if r["status"] == "ok"]
    empty   = [r for r in results if r["status"] == "empty"]
    skipped = [r for r in results if r["status"] == "skipped"]
    total_jobs = sum(r["count"] for r in ok)

    print(_c("-" * 60, _DIM))
    print(f"  {_c('Summary', _BOLD)}")
    print(f"    Companies processed : {len(results)}")
    print(f"    With jobs           : {_c(str(len(ok)), _GREEN)}")
    print(f"    No jobs found       : {_c(str(len(empty)), _YELLOW)}")
    print(f"    Skipped             : {_c(str(len(skipped)), _RED)}")
    print(f"    Total jobs found    : {_c(str(total_jobs), _BOLD)}")
    print(f"    Elapsed             : {elapsed:.1f}s")
    if output_file:
        print(f"    Output file         : {_c(output_file, _CYAN)}")
    print(_c("-" * 60, _DIM))
    print()

# ── Output writer ────────────────────────────────────────────────────────────

def write_output(results: list[dict], path: str) -> str:
    out = Path(path) if path else Path("output") / f"pipeline-{date.today()}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
    return str(out)

# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    args = parse_args()
    companies = load_companies(args.config)

    # Dry-run: just show the list
    if args.dry_run:
        print(_c("\nDry run — companies loaded from config:\n", _BOLD))
        for i, c in enumerate(companies, 1):
            name = c.get("company", "(no name)")
            url  = c.get("careers_url") or c.get("career_url", "(no url)")
            print(f"  {i:>3}. {_c(name, _BOLD)} — {_c(url, _DIM)}")
        print()
        return 0

    print_header(len(companies))

    import time
    t0 = time.monotonic()
    results: list[dict] = []

    for idx, entry in enumerate(companies, 1):
        name = (entry.get("company") or "").strip()
        url  = (entry.get("careers_url") or entry.get("career_url") or "").strip()

        print_company_start(idx, len(companies), name, url)

        # Delegate to runner (which handles detect → connector → scrape → prompt)
        result = _process_one(name, url, args)
        results.append(result)
        print_company_result(result)

    elapsed = time.monotonic() - t0
    output_file = write_output(results, args.output)
    print_summary(results, output_file, elapsed)
    return 0


def _process_one(name: str, url: str, args: argparse.Namespace) -> dict:
    """Thin wrapper so the loop stays clean."""
    from ats_ingestion.runner import process_company
    if not name or not url:
        return {
            "company": name,
            "career_url": url,
            "ats_type": "unknown",
            "confidence": 0.0,
            "strategy": "skipped",
            "jobs": [],
            "count": 0,
            "status": "skipped",
            "reason": "Missing company name or URL in config",
        }
    return process_company(
        name,
        url,
        keyword=args.keyword,
        location=args.location,
        interactive=args.interactive,
    )


if __name__ == "__main__":
    sys.exit(main())
