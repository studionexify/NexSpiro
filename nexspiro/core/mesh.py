"""Mesh helpers for `mesh` plugins (requires trimesh)."""
from pathlib import Path


def load(path: str | Path):
    import trimesh
    return trimesh.load(str(path), force="mesh")


def save(mesh, path: str | Path) -> None:
    mesh.export(str(path))
