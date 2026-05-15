"""Interactive prompts shown when both ATS detection and HTML scraping fail.

Asks the user exactly what it needs and returns either a corrected URL to retry
or skips the company entirely. Designed to never crash and always offer an
escape hatch.
"""

from __future__ import annotations


def prompt_manual_url(company_name: str, original_url: str) -> str | None:
    """
    Ask the user if they know the correct direct jobs URL for this company.

    Returns the entered URL string, or None if the user chooses to skip.
    """
    print()
    print(f"  ⚠  Could not scrape jobs for '{company_name}' ({original_url})")
    print("     Options:")
    print("       [1] Enter a different URL to try")
    print("       [2] Skip this company")
    print()

    choice = input("     Your choice [1/2, default=2]: ").strip()
    if choice != "1":
        return None

    url = input(f"     Enter the direct jobs page URL for {company_name}: ").strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url or None


def prompt_manual_jobs(company_name: str) -> list[dict[str, str]]:
    """
    Last-resort: let the user paste job titles + URLs manually.

    Returns a list of minimal job dicts (title + apply_url) or empty list.
    """
    print()
    print(f"  ✏  Manual entry for '{company_name}'.")
    print("     Paste jobs one per line as:  <title> | <url>")
    print("     Leave blank and press Enter when done.")
    print()

    records: list[dict[str, str]] = []
    while True:
        line = input("     > ").strip()
        if not line:
            break
        if "|" in line:
            parts = line.split("|", 1)
            records.append({"title": parts[0].strip(), "apply_url": parts[1].strip()})
        else:
            records.append({"title": line, "apply_url": ""})

    return records
