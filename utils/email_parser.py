from __future__ import annotations

import imaplib
import email
from email.header import decode_header
from typing import List, Dict


def parse_application_responses(cfg: dict) -> List[Dict[str, str]]:
    """Bonus utility: scan inbox for application response signals."""
    if not cfg.get("enabled"):
        return []

    host = cfg.get("imap_host")
    username = cfg.get("username")
    password = cfg.get("password")
    mailbox = cfg.get("mailbox", "INBOX")

    if not host or not username or not password:
        return []

    results: List[Dict[str, str]] = []

    conn = imaplib.IMAP4_SSL(host)
    conn.login(username, password)
    conn.select(mailbox)

    _, msg_nums = conn.search(None, '(OR SUBJECT "application" SUBJECT "interview")')
    for num in (msg_nums[0] or b"").split()[-25:]:
        _, data = conn.fetch(num, "(RFC822)")
        if not data or not data[0]:
            continue

        msg = email.message_from_bytes(data[0][1])
        subject_raw = msg.get("Subject", "")
        subject, enc = decode_header(subject_raw)[0]
        if isinstance(subject, bytes):
            subject = subject.decode(enc or "utf-8", errors="ignore")

        results.append(
            {
                "from": msg.get("From", ""),
                "subject": str(subject),
                "date": msg.get("Date", ""),
            }
        )

    conn.close()
    conn.logout()
    return results
