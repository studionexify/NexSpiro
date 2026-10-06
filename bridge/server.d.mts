import type { Server } from "node:http";
export function createBridge(driver: { status(c: object): Promise<object>; send(c: object, name: string, data: Buffer, print: boolean): Promise<void>; command(c: object, cmd: string): Promise<void> }, opts?: { allowOrigin?: string }): Server;
