#!/usr/bin/env python3
"""Stage a credential-free backend preview without committing its signing secret.

The private temporary directory can be passed to the Vercel skill's claimable deploy helper.
Live provider credentials are deliberately not copied; configure them after claiming the project.
"""

import json
import os
from pathlib import Path
import secrets
import shutil
import tempfile

root = Path(__file__).resolve().parents[1]
stage = Path(tempfile.mkdtemp(prefix="spotter-backend-preview-"))
os.chmod(stage, 0o700)
shutil.copytree(
    root / "backend",
    stage,
    dirs_exist_ok=True,
    ignore=shutil.ignore_patterns(
        ".venv", ".env", ".env.*", "__pycache__", ".pytest_cache", ".ruff_cache",
        ".hypothesis", "tests", ".vercel", "*.sqlite3", "staticfiles",
    ),
)
config_path = stage / "vercel.json"
config = json.loads(config_path.read_text())
config["env"] = {
    "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
    "DJANGO_DEBUG": "false",
    "DJANGO_ALLOWED_HOSTS": ".vercel.app",
}
config_path.write_text(json.dumps(config, indent=2) + "\n")
os.chmod(config_path, 0o600)
print(stage)
