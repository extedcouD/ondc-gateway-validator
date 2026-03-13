// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

import { createAdapter } from "./utils/createAdapter";
import { createSchemas } from "./utils/createSchemas";
import { createPlugins } from "./utils/createPlugins";

async function main(): Promise<void> {
    createAdapter();
    await createSchemas();
    await createPlugins();
}

main();
