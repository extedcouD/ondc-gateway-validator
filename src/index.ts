// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

import { createAdapter } from "./utils/createAdapter";
import { createSchemas } from "./utils/createSchemas";
import { createPlugins } from "./utils/createPlugins";
import { createDocker } from "./utils/createDocker";

async function main(): Promise<void> {
    createAdapter();
    await createSchemas();
    await createPlugins();
    createDocker();
}

main();
