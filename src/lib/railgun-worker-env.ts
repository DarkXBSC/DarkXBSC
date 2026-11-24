// The upstream CommonJS SDK uses Node globals in its browser encryption path.
import { Buffer } from "buffer";
import process from "process/browser";
Object.assign(globalThis, { Buffer, process, global: globalThis });
