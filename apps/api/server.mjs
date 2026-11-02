// Vercel's Hono preset picks this file up. It loads the tsdown bundle, so Vercel never compiles the workspace TypeScript itself.
import "hono";

export { default } from "./dist/main.mjs";
