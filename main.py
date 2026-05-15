#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio

from agents.browser_agent import run_agent_command_sync
from core.config import load_config
from executor.pipeline import run_pipeline_sync
from executor.scheduler import run_scheduler
from utils.logging import get_logger

logger = get_logger("main")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Career Engine AI job automation")
    parser.add_argument("--config", default="config.yaml", help="Path to config file")
    parser.add_argument(
        "--mode",
        default="once",
        choices=["once", "scheduler", "agent"],
        help="Execution mode",
    )
    parser.add_argument(
        "--command",
        default="",
        help="Agent command, e.g. 'Apply to backend jobs matching my resume'",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = load_config(args.config)

    if args.mode == "once":
        summary = run_pipeline_sync(config)
        logger.info("Run-once summary: %s", summary)
        return 0

    if args.mode == "scheduler":
        asyncio.run(run_scheduler(config))
        return 0

    if args.mode == "agent":
        if not args.command:
            raise ValueError("--command is required for --mode agent")
        result = run_agent_command_sync(config, args.command)
        logger.info("Agent result: %s", result)
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
