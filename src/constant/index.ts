// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

import path from "path/win32";

// __dirname is `dist/` at runtime; the project root is one level up
export const PROJECT_ROOT = path.resolve(__dirname, "..");
export const CONFIG_FOLDER = path.join(PROJECT_ROOT, "src", "configs");
export const SAMPLE_ADAPTER = path.join(
    PROJECT_ROOT,
    "src",
    "samples",
    "adapter.yaml",
);
export const OUTPUT_DIR = path.join(PROJECT_ROOT, "build-output", "config");
export const OUTPUT_FILE = path.join(OUTPUT_DIR, "adapter.yaml");
