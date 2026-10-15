"""Executes a plugin in a child process with a timeout; writes output atomically."""
from __future__ import annotations
import logging
import multiprocessing as mp
import os
import tempfile
import traceback
from pathlib import Path

from ..core import gcode as gc
from ..core.plugin_api import PluginContext, PluginError
from ..core.registry import discover


def _worker(plugin_id: str, path: str, raw_params: dict, q) -> None:
    try:
        spec = discover()[plugin_id]
        params = spec.resolve_params(raw_params)
        log = logging.getLogger(f"nexspiro.{plugin_id}")
        p = Path(path)
        fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=p.name + ".", suffix=".tmp")
        os.close(fd)
        try:
            if spec.kind == "gcode":
                text = p.read_bytes().decode("utf-8")
                g = gc.GCode.parse(text)
                spec.load().run(PluginContext(path, log, gcode=g, config=g.config), params)
                Path(tmp).write_bytes(g.render().encode("utf-8"))
            elif spec.kind == "mesh":
                from ..core import mesh
                m = mesh.load(p)
                ctx = PluginContext(path, log, mesh=m)
                spec.load().run(ctx, params)
                mesh.save(ctx.mesh, tmp + p.suffix)
                os.replace(tmp + p.suffix, tmp)
            else:
                raise PluginError(f"unknown kind {spec.kind}")
            os.replace(tmp, p)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        q.put(None)
    except BaseException:
        q.put(traceback.format_exc())


def run_plugin(plugin_id: str, path: str, params: dict, timeout: float = 120.0) -> None:
    if plugin_id not in discover():
        raise PluginError(f"plugin '{plugin_id}' not found")
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    proc = ctx.Process(target=_worker, args=(plugin_id, str(path), params, q), daemon=True)
    proc.start()
    proc.join(timeout)
    if proc.is_alive():
        proc.kill()
        proc.join()
        raise PluginError(f"plugin '{plugin_id}' timed out after {timeout}s; file left unchanged")
    err = q.get() if not q.empty() else f"plugin process exited with code {proc.exitcode}"
    if err:
        raise PluginError(err)
