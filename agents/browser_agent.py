from __future__ import annotations

import asyncio
from typing import List

from core.config import AppConfig
from executor.pipeline import JobAutomationPipeline
from utils.logging import get_logger

logger = get_logger("browser-agent")


class BrowserAgent:
    """Simple command-driven agent for Comet-like behavior."""

    def __init__(self, config: AppConfig) -> None:
        self.config = config

    async def run_command(self, command: str) -> dict:
        command_low = command.lower().strip()

        if "apply" in command_low and "backend" in command_low:
            self.config.keywords = list(set(self.config.keywords + ["backend", "api", "python"]))
        elif "frontend" in command_low:
            self.config.keywords = list(set(self.config.keywords + ["frontend", "react", "javascript"]))
        elif "data" in command_low:
            self.config.keywords = list(set(self.config.keywords + ["data", "ml", "analytics"]))

        pipeline = JobAutomationPipeline(self.config)
        try:
            result = await pipeline.run_once()
            logger.info("Agent command executed: %s | result=%s", command, result)
            return result
        finally:
            await pipeline.close()


def run_agent_command_sync(config: AppConfig, command: str) -> dict:
    agent = BrowserAgent(config)
    return asyncio.run(agent.run_command(command))
