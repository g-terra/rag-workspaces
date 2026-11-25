"""Pin the component tests' requirements to what a Langflow release runs.

    uv run --no-project --with packaging python pin-test-requirements.py v1.13.3

Reads Langflow's uv.lock at that tag, takes each package's version for the image's Python (3.14) on Linux,
and compiles requirements-test.in against those versions into requirements-test.txt. Needs uv and network; run it from langflow/.
Langflow's own workspace packages (lfx) are not in the lock: they are pinned to the tag's version.
"""

import subprocess
import sys
import tempfile
import tomllib
import urllib.request
from pathlib import Path

PYTHON = "3.14"
HERE = Path(__file__).parent


def lock_pins(lock: dict) -> list[str]:
    from packaging.markers import Marker

    env = {"python_version": PYTHON, "python_full_version": f"{PYTHON}.0", "sys_platform": "linux",
           "platform_system": "Linux", "platform_machine": "x86_64", "implementation_name": "cpython",
           "platform_python_implementation": "CPython", "os_name": "posix", "extra": ""}
    by_name: dict[str, list[dict]] = {}
    for package in lock["package"]:
        by_name.setdefault(package["name"], []).append(package)
    pins = []
    for name, entries in sorted(by_name.items()):
        fits = [e for e in entries
                if not e.get("resolution-markers") or any(Marker(m).evaluate(env) for m in e["resolution-markers"])]
        versions = {e["version"] for e in fits if "registry" in e.get("source", {})}
        if len(versions) == 1:
            pins.append(f"{name}=={versions.pop()}")
    return pins


def main(tag: str) -> None:
    url = f"https://raw.githubusercontent.com/langflow-ai/langflow/{tag}/uv.lock"
    lock = tomllib.loads(urllib.request.urlopen(url, timeout=60).read().decode())
    with tempfile.TemporaryDirectory() as tmp:
        constraints = Path(tmp) / "constraints.txt"
        constraints.write_text("\n".join([*lock_pins(lock), f"lfx=={tag.lstrip('v')}"]) + "\n")
        subprocess.run(
            ["uv", "pip", "compile", "--quiet", str(HERE / "requirements-test.in"), "-c", str(constraints),
             "--python-version", PYTHON, "--python-platform", "x86_64-unknown-linux-gnu", "--no-annotate",
             "--custom-compile-command", f"uv run --no-project --with packaging python pin-test-requirements.py {tag}",
             "-o", str(HERE / "requirements-test.txt")],
            check=True,
        )


if __name__ == "__main__":
    main(sys.argv[1])
