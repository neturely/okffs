// Side-effect module: load .env (with git-root inheritance, #308) before any
// module that reads process.env at import time (config.ts, github.ts). Import
// it FIRST in each entrypoint — ESM evaluates static imports in order, so this
// replaces the former `import "dotenv/config"` one-for-one.
import { loadEnv } from "./env_load.js";

loadEnv();
