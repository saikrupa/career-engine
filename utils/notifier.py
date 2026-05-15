from __future__ import annotations

import json
import smtplib
from email.mime.text import MIMEText
from typing import Any, Dict

import requests

from utils.logging import get_logger

logger = get_logger("notifier")


def notify_console(message: str) -> None:
    logger.info(message)


def notify_slack(webhook_url: str, message: str) -> None:
    if not webhook_url:
        return
    try:
        requests.post(webhook_url, json={"text": message}, timeout=8)
    except Exception as exc:
        logger.warning("Slack notification failed: %s", exc)


def notify_telegram(bot_token: str, chat_id: str, message: str) -> None:
    if not bot_token or not chat_id:
        return
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        requests.post(url, json={"chat_id": chat_id, "text": message}, timeout=8)
    except Exception as exc:
        logger.warning("Telegram notification failed: %s", exc)


def notify_email(email_cfg: Dict[str, Any], message: str) -> None:
    if not email_cfg.get("enabled"):
        return
    try:
        msg = MIMEText(message)
        msg["Subject"] = email_cfg.get("subject", "Career Engine Alert")
        msg["From"] = email_cfg["from"]
        msg["To"] = email_cfg["to"]
        with smtplib.SMTP(email_cfg["host"], int(email_cfg.get("port", 587))) as server:
            server.starttls()
            server.login(email_cfg["username"], email_cfg["password"])
            server.send_message(msg)
    except Exception as exc:
        logger.warning("Email notification failed: %s", exc)


def notify_all(notify_cfg: Dict[str, Any], message: str) -> None:
    notify_console(message)
    notify_slack((notify_cfg.get("slack") or {}).get("webhook_url", ""), message)
    tg = notify_cfg.get("telegram") or {}
    notify_telegram(tg.get("bot_token", ""), tg.get("chat_id", ""), message)
    notify_email(notify_cfg.get("email") or {}, message)
