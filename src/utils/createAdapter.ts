import fs from "fs";
import yaml from "js-yaml";
import { globSync } from "glob";
import {
    CONFIG_FOLDER,
    OUTPUT_DIR,
    OUTPUT_FILE,
    SAMPLE_ADAPTER,
} from "../constant";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Schema expected in every build.yaml */
interface BuildConfig {
    domain: string; // e.g. "ONDC:FIS12"
    version: string; // e.g. "2.0.0"
    roles: string[]; // e.g. ["bap", "bpp"]
    stateFullValidations: boolean;
    debugMode: boolean;
}

/** Loose type for the parsed adapter.yaml */
interface AdapterConfig {
    appName?: string;
    log?: unknown;
    http?: unknown;
    pluginManager?: unknown;
    modules?: AdapterModule[];
    [key: string]: unknown;
}

interface AdapterModule {
    name: string;
    path: string;
    handler: {
        type: string;
        role: string;
        httpClientConfig: Record<string, unknown>;
        plugins: Record<string, unknown>;
        steps: string[];
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert "ONDC:FIS12" + "2.0.0" + "bap" → "ONDCFIS12_200_bap" style suffix */
function moduleId(domain: string, version: string, role: string): string {
    const domainTag = domain.replace(/[^a-zA-Z0-9]/g, ""); // e.g. ONDCFIS12
    const versionTag = version.replace(/\./g, ""); // e.g. 200
    return `${domainTag}_${versionTag}`;
}

/**
 * Build a single AdapterModule.
 * Accepts shared object references for httpClientConfig and schemaValidator so
 * that js-yaml can emit YAML anchors/aliases instead of repeating the blocks.
 */
function buildModule(
    cfg: BuildConfig,
    role: string,
    sharedHttpClientConfig: Record<string, unknown>,
    sharedSchemaValidator: Record<string, unknown>,
    sharedSteps: string[],
): AdapterModule {
    const id = moduleId(cfg.domain, cfg.version, role);
    const validatorId = `ondcvalidator_${id}`;

    return {
        name: `validator_${id}`,
        path: `/ondc/${cfg.domain}/${cfg.version}/validate/`,
        handler: {
            type: "std",
            role,
            httpClientConfig: sharedHttpClientConfig,
            plugins: {
                schemaValidator: sharedSchemaValidator,
                ondcValidator: {
                    id: validatorId,
                    config: {
                        stateFullValidations: cfg.stateFullValidations,
                        debugMode: cfg.debugMode,
                    },
                },
            },
            steps: sharedSteps,
        },
    };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Reads every build.yaml found under CONFIG_FOLDER, generates one AdapterModule
 * per (domain, version, role) combination, merges them into the base
 * adapter.yaml template, and writes the result to build-output/config/adapter.yaml.
 */
export function createAdapter(): void {
    // 1. Load base template
    const templateRaw = fs.readFileSync(SAMPLE_ADAPTER, "utf8");
    const template = yaml.load(templateRaw) as AdapterConfig;

    // Shared objects – single JS references so js-yaml emits anchors/aliases
    const sharedHttpClientConfig: Record<string, unknown> = {
        maxIdleConns: 1000,
        maxIdleConnsPerHost: 200,
        idleConnTimeout: "300s",
        responseHeaderTimeout: "5s",
    };
    const sharedSchemaValidator: Record<string, unknown> = {
        id: "schemavalidator",
        config: { schemaDir: "./schemas" },
    };
    const sharedSteps: string[] = ["validateSchema", "validateOndcPayload"];

    const generatedModules: AdapterModule[] = [];

    // 2. Discover all adapter.config.yaml files (separate from OpenAPI build.yaml)
    const buildFiles = globSync("**/adapter.config.yaml", {
        cwd: CONFIG_FOLDER,
        absolute: true,
    });

    if (buildFiles.length === 0) {
        console.warn(
            `[createAdapter] No adapter.config.yaml files found under ${CONFIG_FOLDER}`,
        );
    }

    // 3. Parse each adapter.config.yaml and generate modules (bap role only)
    for (const filePath of buildFiles) {
        const raw = fs.readFileSync(filePath, "utf8");
        const cfg = yaml.load(raw) as BuildConfig;

        if (!cfg || !cfg.domain || !cfg.version || !Array.isArray(cfg.roles)) {
            console.warn(
                `[createAdapter] Skipping malformed adapter.config.yaml: ${filePath}`,
            );
            continue;
        }

        const bapRoles = cfg.roles.filter((r) => r === "bap");

        console.log(
            `[createAdapter] Processing ${filePath} → domain=${cfg.domain} version=${cfg.version} roles=${bapRoles.join(",")}`,
        );

        for (const role of bapRoles) {
            generatedModules.push(
                buildModule(
                    cfg,
                    role,
                    sharedHttpClientConfig,
                    sharedSchemaValidator,
                    sharedSteps,
                ),
            );
        }
    }

    // 4. Merge: base template config + generated modules
    const output: AdapterConfig = {
        ...template,
        modules: generatedModules,
    };

    // 5. Serialise to YAML with anchors/aliases (noRefs: false) and write to build output
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outYaml = yaml.dump(output, { lineWidth: 120, noRefs: false });
    fs.writeFileSync(OUTPUT_FILE, outYaml, "utf8");

    console.log(
        `[createAdapter] Written → ${OUTPUT_FILE} (${generatedModules.length} module(s))`,
    );
}
