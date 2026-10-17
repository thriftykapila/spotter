.PHONY: install dev test build lint

install:
	cd backend && uv sync --python 3.13
	cd frontend && npm ci

dev:
	bash scripts/dev.sh

test:
	cd backend && uv run pytest
	cd frontend && npm test

build:
	cd frontend && npm run build

lint:
	cd backend && uv run ruff check .
