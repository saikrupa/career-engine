#!/usr/bin/env python3
"""Example command-line entrypoint for ATS ingestion."""

from __future__ import annotations

import argparse
import json
import sys

from ats_ingestion.pipeline import ingest_company_jobs


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest jobs from a company career URL.")
    parser.add_argument("--company", required=True, help="Company name")
    parser.add_argument("--url", required=True, help="Career page URL")
    parser.add_argument("--keyword", default="", help="Optional keyword filter")
    parser.add_argument("--location", default="", help="Optional location filter")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = ingest_company_jobs(
        company_name=args.company,
        career_url=args.url,
        keyword=args.keyword,
        location=args.location,
    )
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
