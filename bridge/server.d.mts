import type { Server } from "node:http";
export function isLanTarget(url: string): Promise<boolean>;
export function createBridge(driver: { status(c: object): Promise<object>; send(c: object, name: string, data: Buffer, print: boolean): Promise<void>; command(c: object, cmd: string): Promise<void> }, opts?: { allowOrigin?: string; staticDir?: string; scan?: () => Promise<object[]> }): Server;
