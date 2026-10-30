"""Pre-deploy guard for the Modal voice services. Run before deploying:
python3 modal-voice/check_no_shadow.py

- No shadowing: `modal deploy tts_service.py` uploads the file as
  /root/tts_service.py, so if the file were named `qwen_tts.py`, its own
  `from qwen_tts import ...` would import itself and fail with ImportError —
  but only on the container, never locally.
- App returned: the `def api` entrypoint (@modal.asgi_app) must return the
  FastAPI app, or every request 500s with 'NoneType' object is not callable.
"""

import ast
import os
import sys


def shadowed(directory: str) -> list:
    problems = []
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".py") or name == os.path.basename(__file__):
            continue
        stem = name.removesuffix(".py")
        with open(os.path.join(directory, name), encoding="utf-8") as f:
            tree = ast.parse(f.read())
        roots = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                roots.add(node.module.split(".")[0])
        if stem in roots:
            problems.append(f"{name} shadows its own `import {stem}`")
    return problems


def missing_app_return(directory: str) -> list:
    problems = []
    for name in sorted(os.listdir(directory)):
        if not name.endswith(".py") or name == os.path.basename(__file__):
            continue
        with open(os.path.join(directory, name), encoding="utf-8") as f:
            tree = ast.parse(f.read())
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name == "api":
                if not any(isinstance(s, ast.Return) for s in node.body):
                    problems.append(f"{name} defines api() but never returns the app")
    return problems


if __name__ == "__main__":
    directory = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    found = shadowed(directory) + missing_app_return(directory)
    if found:
        print("\n".join(found))
        sys.exit(1)
    print("OK: guard passed")
