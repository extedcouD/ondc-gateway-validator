import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { execSync } from "child_process";
import { globSync } from "glob";
import { CONFIG_FOLDER, OUTPUT_DIR, PROJECT_ROOT } from "../constant";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = path.join(PROJECT_ROOT, "go-templates");
const PLUGINS_OUTPUT_DIR = path.join(PROJECT_ROOT, "build-output", "plugins");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenApiSpec {
    info: {
        version: string;
        domain?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface DomainEntry {
    domain: string;
    version: string;
    domainFilename: string;
    versionFileName: string;
    buildPath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** e.g. "ONDC:FIS12" + "2.3.0" → "ondcvalidator_ONDCFIS12_230" */
function pluginId(domain: string, version: string): string {
    const domainTag = domain.replace(/[^a-zA-Z0-9]/g, "");
    const versionTag = version.replace(/\./g, "");
    return `ondcvalidator_${domainTag}_${versionTag}`;
}

function copyDir(src: string, dest: string): void {
    fs.cpSync(src, dest, { recursive: true });
}

// ---------------------------------------------------------------------------
// Step 1: generateValidations – runs validations.sh for one domain/version
// ---------------------------------------------------------------------------

async function generateValidations(entry: DomainEntry): Promise<void> {
    const { domain, version, domainFilename, versionFileName, buildPath } =
        entry;

    const outputPath = path.join(
        OUTPUT_DIR,
        "temp",
        "validations",
        domainFilename,
        versionFileName,
    );

    console.log(
        `[createPlugins] Generating L1 validations → domain=${domain} version=${version}`,
    );

    fs.mkdirSync(outputPath, { recursive: true });

    const scriptPath = path.resolve(process.cwd(), "scripts/validations.sh");

    try {
        execSync(`bash "${scriptPath}" "${buildPath}" "${outputPath}"`, {
            cwd: process.cwd(),
            stdio: "inherit",
            shell: "/bin/bash",
        });
        console.log(`✅ L1 validations generated at ${outputPath}`);
    } catch (error: any) {
        console.error("❌ L1 validation generation failed!");
        console.error("Error:", error.message);
        throw error;
    }
}

// ---------------------------------------------------------------------------
// Step 2: assembleOndcValidatorPlugin
//   • Copy go-templates/ → build-output/plugins/ondcvalidator_<id>/
//   • Replace ondc-validator/validationpkg with the generated one
//   • Build .so from ondc-validator/cmd
// ---------------------------------------------------------------------------

function assembleOndcValidatorPlugin(entry: DomainEntry): void {
    const { domain, version, domainFilename, versionFileName } = entry;
    const id = pluginId(domain, version);
    const pluginDir = path.join(PLUGINS_OUTPUT_DIR, id);

    console.log(
        `[createPlugins] Assembling ondcvalidator plugin → ${pluginDir}`,
    );

    // 1. Fresh copy of the full go-templates tree
    if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    copyDir(TEMPLATES_DIR, pluginDir);

    // 2. Replace ondc-validator/validationpkg with the generated one
    const generatedValidationpkg = path.join(
        OUTPUT_DIR,
        "temp",
        "validations",
        domainFilename,
        versionFileName,
        "validationpkg",
    );
    const targetValidationpkg = path.join(
        pluginDir,
        "ondc-validator",
        "validationpkg",
    );

    if (!fs.existsSync(generatedValidationpkg)) {
        throw new Error(
            `[createPlugins] Generated validationpkg not found: ${generatedValidationpkg}`,
        );
    }

    fs.rmSync(targetValidationpkg, { recursive: true, force: true });
    copyDir(generatedValidationpkg, targetValidationpkg);

    // 3. Build .so from ondc-validator/cmd
    const soFile = path.join(pluginDir, `${id}.so`);
    console.log(`[createPlugins] Building ${id}.so ...`);

    try {
        execSync(
            `go build -buildmode=plugin -o "${soFile}" ./ondc-validator/cmd`,
            {
                cwd: pluginDir,
                stdio: "inherit",
                shell: "/bin/bash",
                env: { ...process.env, CGO_ENABLED: "1" },
            },
        );
        console.log(`✅ Built ${id}.so`);
    } catch (error: any) {
        console.error(`❌ Failed to build ${id}.so`);
        throw error;
    }
}

// ---------------------------------------------------------------------------
// Step 3: assembleSchemaValidatorPlugin (built once, shared across all versions)
//   • Copy go-templates/ → build-output/plugins/schemavalidator/
//   • Build .so from schemavalidator/cmd
// ---------------------------------------------------------------------------

function assembleSchemaValidatorPlugin(): void {
    const pluginDir = path.join(PLUGINS_OUTPUT_DIR, "schemavalidator");

    console.log(
        `[createPlugins] Assembling schemavalidator plugin → ${pluginDir}`,
    );

    if (fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
    }
    copyDir(TEMPLATES_DIR, pluginDir);

    const soFile = path.join(pluginDir, "schemavalidator.so");
    console.log(`[createPlugins] Building schemavalidator.so ...`);

    try {
        execSync(
            `go build -buildmode=plugin -o "${soFile}" ./schemavalidator/cmd`,
            {
                cwd: pluginDir,
                stdio: "inherit",
                shell: "/bin/bash",
                env: { ...process.env, CGO_ENABLED: "1" },
            },
        );
        console.log(`✅ Built schemavalidator.so`);
    } catch (error: any) {
        console.error(`❌ Failed to build schemavalidator.so`);
        throw error;
    }
}

// ---------------------------------------------------------------------------
// createPlugins – orchestrates all three steps
// ---------------------------------------------------------------------------

export async function createPlugins(): Promise<void> {
    fs.mkdirSync(PLUGINS_OUTPUT_DIR, { recursive: true });

    // Discover all build.yaml OpenAPI specs
    const buildFiles = globSync("**/build.yaml", {
        cwd: CONFIG_FOLDER,
        absolute: true,
    });

    if (buildFiles.length === 0) {
        console.warn(
            `[createPlugins] No build.yaml files found under ${CONFIG_FOLDER}`,
        );
        return;
    }

    // Parse domain/version from each spec
    const entries: DomainEntry[] = [];

    for (const buildPath of buildFiles) {
        const raw = fs.readFileSync(buildPath, "utf8");
        const spec = yaml.load(raw) as OpenApiSpec;

        if (!spec?.info?.version) {
            console.warn(
                `[createPlugins] Skipping ${buildPath} – missing info.version`,
            );
            continue;
        }

        const version = spec.info.version;

        let domain: string;
        if (spec.info.domain) {
            domain = spec.info.domain;
        } else {
            const domainDir = path.basename(
                path.dirname(path.dirname(buildPath)),
            );
            domain = `ONDC:${domainDir.toUpperCase()}`;
            console.warn(
                `[createPlugins] No info.domain in ${buildPath}, inferred domain as "${domain}"`,
            );
        }

        entries.push({
            domain,
            version,
            domainFilename: domain.toLowerCase().replace(":", "_"),
            versionFileName: `v${version}`,
            buildPath,
        });
    }

    // Step 1: Generate all validationpkg outputs first
    for (const entry of entries) {
        await generateValidations(entry);
    }

    // Step 2: Assemble + build one ondcvalidator plugin per domain/version
    for (const entry of entries) {
        assembleOndcValidatorPlugin(entry);
    }

    // Step 3: Assemble + build schemavalidator once
    assembleSchemaValidatorPlugin();

    console.log("[createPlugins] All plugins built.");
}
