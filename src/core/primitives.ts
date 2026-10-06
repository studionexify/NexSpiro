// Parametric bodies of revolution: radius (mm) as a function of height fraction t ∈ [0,1].
export type Profile = { name: string; height: number; radius: (t: number) => number };

export const primitives = {
  vase: (height = 120, rBase = 35, rBelly = 50, rNeck = 25): Profile => ({
    name: "vase",
    height,
    radius: (t) => rBase + (rBelly - rBase) * Math.sin(Math.PI * t) + (rNeck - rBase) * t,
  }),
  bowl: (height = 60, rBase = 40, rRim = 100): Profile => ({
    name: "bowl",
    height,
    radius: (t) => rBase + (rRim - rBase) * Math.sqrt(t),
  }),
  shade: (height = 140, rTop = 18, rBottom = 60): Profile => ({
    // Bulb-like pendant shade (printed upside-down: wide end on bed).
    name: "shade",
    height,
    radius: (t) => rTop + (rBottom - rTop) * Math.pow(Math.cos((t * Math.PI) / 2), 1.6),
  }),
  cylinder: (height = 50, r = 30): Profile => ({ name: "cylinder", height, radius: () => r }),
};
export type PrimitiveName = keyof typeof primitives;
