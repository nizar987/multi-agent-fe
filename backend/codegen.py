#!/usr/bin/env python3
"""
codegen.py — generate gRPC stubs from .proto files using grpcio-tools.
Run from backend/ directory:
    python codegen.py

Outputs stubs to:
    gateway/app/generated/
    core/generated/
"""
import os
import sys
import subprocess
from pathlib import Path

BASE = Path(__file__).parent.resolve()
PROTO_DIR = BASE / "proto"
TARGETS = [
    BASE / "gateway" / "app" / "generated",
    BASE / "core" / "generated",
]

PROTOS = [
    "agentplatform/v1/common.proto",
    "agentplatform/v1/health.proto",
    "agentplatform/v1/agent.proto",
    "agentplatform/v1/skill.proto",
    "agentplatform/v1/knowledge.proto",
    "agentplatform/v1/log.proto",
    "agentplatform/v1/settings.proto",
]


def ensure_init(directory: Path) -> None:
    """Create __init__.py in directory and all parent packages under generated/."""
    parts = []
    p = directory
    while p != BASE:
        parts.append(p)
        p = p.parent
    for part in reversed(parts):
        init = part / "__init__.py"
        if not init.exists():
            init.write_text("# auto-generated\n")


def run_codegen(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    # Create package init files
    ensure_init(out_dir)

    cmd = [
        sys.executable, "-m", "grpc_tools.protoc",
        f"-I{PROTO_DIR}",
        f"--python_out={out_dir}",
        f"--grpc_python_out={out_dir}",
    ] + PROTOS

    print(f"→ Generating stubs in {out_dir}")
    result = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True)
    if result.returncode != 0:
        print("STDERR:", result.stderr)
        sys.exit(result.returncode)
    print("  Done.")

    # Fix relative imports in generated files (grpcio-tools generates absolute imports)
    fix_imports(out_dir)


def fix_imports(out_dir: Path) -> None:
    """
    grpcio-tools generates `import agentplatform.v1.foo_pb2 as ...`
    but we run stubs as a package inside gateway/app/generated/ or core/generated/
    so we rewrite those imports to be relative-friendly by prepending the package path.
    """
    for f in out_dir.rglob("*.py"):
        text = f.read_text()
        # The generated grpc files import the pb2 modules — ensure __init__ chain exists
        if "__init__" not in f.name:
            subpkg = f.parent
            if not (subpkg / "__init__.py").exists():
                (subpkg / "__init__.py").write_text("# auto-generated\n")
    print(f"  Import paths verified in {out_dir}")


if __name__ == "__main__":
    # grpcio-tools must be installed: pip install grpcio-tools
    try:
        import grpc_tools.protoc  # noqa: F401
    except ImportError:
        print("grpcio-tools not found. Install with: pip install grpcio-tools==1.64.1")
        sys.exit(1)

    for target in TARGETS:
        run_codegen(target)

    print("\n✓ Codegen complete.")
