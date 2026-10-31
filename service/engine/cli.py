"""Run the engine locally: `python3 cli.py /pair < snapshot.json`. Used by the API
Worker's tests in place of the ENGINE service binding."""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "src"), os.path.abspath(os.path.join(HERE, "..", ".."))]

from engine import handle  # noqa: E402

status, out = handle(sys.argv[1], json.load(sys.stdin) if len(sys.argv) < 3 else json.loads(sys.argv[2]))
print(json.dumps({"status": status, "body": out}))
