from nexspiro.core.plugin_api import NexPlugin


class Plugin(NexPlugin):
    def run(self, ctx, params):
        n = 0
        for line in ctx.gcode.moves(params["feature"]):
            if "F" in line.params:
                line.set(F=line.params["F"] * params["factor"])
                n += 1
        ctx.log.info("scaled %d moves on '%s'", n, params["feature"])
