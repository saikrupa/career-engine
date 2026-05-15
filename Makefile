# ── Career Engine Automation ────────────────────────────────────────────────
# Usage:
#   make run                -> scheduler mode
#   make once               -> one pipeline cycle
#   make agent CMD="..."   -> command-driven agent run
#   make dashboard          -> streamlit dashboard
#   make ingest             -> previous ATS ingestion runner
#   make install            -> python deps for automation system

PYTHON  := python3
SCRIPT  := main.py
INGEST  := run_pipeline.py
ARGS    ?=
CMD     ?= Apply to backend jobs matching my resume

.PHONY: run once agent dashboard ingest dry-run install help

run:           ## Start scheduler mode (5-minute loop)
	bash run.sh scheduler

once:          ## Run one cycle immediately
	bash run.sh once

agent:         ## Run agent mode with a natural-language command
	bash run.sh agent "$(CMD)"

dashboard:     ## Launch streamlit dashboard
	streamlit run dashboard/app.py

ingest:        ## Legacy ATS ingestion command
	$(PYTHON) $(INGEST) $(ARGS)

dry-run:       ## Preview company list — no network calls
	$(PYTHON) $(INGEST) --dry-run $(ARGS)

install:       ## Install Python dependencies
	$(PYTHON) -m pip install -r requirements.txt
	$(PYTHON) -m playwright install chromium

help:          ## Show available make targets
	@echo ""
	@echo "  Career Engine Automation"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*##"}; {printf "  make %-14s %s\n", $$1, $$2}'
	@echo ""
