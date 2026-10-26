"""Report installer phase duration in logs and the GitHub job summary"""

from contextlib import contextmanager
import os
from time import perf_counter


@contextmanager
def phase(name: str):
    """Measure a phase even when it fails, without hiding its exception"""
    started = perf_counter()
    try:
        yield
    finally:
        duration = perf_counter() - started
        print(f"IFW timing: {name}: {duration:.2f}s", flush=True)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as output:
                output.write(f"- IFW {name}: {duration:.2f}s\n")
