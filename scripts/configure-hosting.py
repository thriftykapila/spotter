#!/usr/bin/env python3
"""Set the frontend's same-origin API rewrite after deploying the backend."""

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("backend_origin", help="Backend HTTPS origin, e.g. https://spotter-api.vercel.app")
args = parser.parse_args()
origin = args.backend_origin.rstrip("/")
parts = urlparse(origin)
if parts.scheme != "https" or not parts.netloc or parts.path or parts.query or parts.fragment:
    parser.error("Provide an HTTPS origin without a path, query, or fragment")
config_path = Path(__file__).resolve().parents[1] / "frontend" / "vercel.json"
config = json.loads(config_path.read_text())
config["rewrites"][0]["destination"] = f"{origin}/api/:path*"
config_path.write_text(json.dumps(config, indent=2) + "\n")
print(f"Configured frontend API rewrite to {origin}")
