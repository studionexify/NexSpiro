declare module "occt-import-js" {
  import type { Occt } from "../io/importers/step.ts";
  const factory: (opts?: { locateFile?: (path: string) => string }) => Promise<Occt>;
  export default factory;
}
