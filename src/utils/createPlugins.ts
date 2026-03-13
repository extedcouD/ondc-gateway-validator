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

/** Escape special regex characters in a literal string (e.g. dots and slashes in module paths). */
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
// rewriteModuleName
//   Recursively rewrites every .go and go.mod file in `dir`, replacing all
//   occurrences of the old module import path with the new unique one.
//   This ensures two plugins compiled from the same template have distinct
//   Go import paths and don't trigger "plugin already loaded".
// ---------------------------------------------------------------------------

function rewriteModuleName(
    dir: string,
    oldName: string,
    newName: string,
): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            rewriteModuleName(fullPath, oldName, newName);
        } else if (
            entry.isFile() &&
            (entry.name.endsWith(".go") ||
                entry.name === "go.mod" ||
                entry.name === "go.sum")
        ) {
            const content = fs.readFileSync(fullPath, "utf8");
            // Replace exact module declaration and all import paths that start with oldName
            // e.g. "validationpkg" → "validationpkg_ONDCFIS12_200"
            //      "validationpkg/jsonvalidations" → "validationpkg_ONDCFIS12_200/jsonvalidations"
            const esc = escapeRegex(oldName);
            const updated = content
                // module declaration  e.g.  module validationpkg  or  module github.com/foo/bar
                .replace(
                    new RegExp(`module ${esc}(?=$|\\s)`, "gm"),
                    `module ${newName}`,
                )
                // replace directive  e.g.  replace validationpkg => ./...
                .replace(
                    new RegExp(`replace ${esc}(?=\\s|$)`, "gm"),
                    `replace ${newName}`,
                )
                // inline require  e.g.  require validationpkg v0.0.0-...
                .replace(
                    new RegExp(`require ${esc}(?=\\s|$)`, "gm"),
                    `require ${newName}`,
                )
                // block require  e.g.  \tvalidationpkg v0.0.0-...
                .replace(
                    new RegExp(`^(\\t)${esc}(\\s+v)`, "gm"),
                    `$1${newName}$2`,
                )
                // Go import strings  e.g.  "validationpkg/storageutils"  or  "github.com/foo/bar/pkg"
                .replace(
                    new RegExp(`"${esc}(\/[^"]*)?"`, "g"),
                    (_match, sub) => `"${newName}${sub ?? ""}"`,
                );
            if (updated !== content) {
                fs.writeFileSync(fullPath, updated, "utf8");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Step 2: assembleOndcValidatorPlugin
//   • Copy go-templates/ → build-output/plugins/ondcvalidator_<id>/
//   • Replace ondc-validator/validationpkg with the generated one
//   • Rewrite validationpkg module name to a unique id to avoid "plugin already loaded"
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

    // 3a. Rewrite validationpkg sub-module name to a unique id.
    const uniqueModuleName = `validationpkg_${id}`;
    console.log(
        `[createPlugins] Rewriting module name: validationpkg → ${uniqueModuleName}`,
    );
    rewriteModuleName(pluginDir, "validationpkg", uniqueModuleName);

    // 3b. Rewrite the ROOT module path to a unique value.
    //     Go's plugin loader uses the root module path baked into the binary
    //     to detect duplicates. Two .so files built from the same root module
    //     path will trigger "plugin already loaded" even with different filenames.
    const rootGoMod = path.join(pluginDir, "go.mod");
    const rootGoModContent = fs.readFileSync(rootGoMod, "utf8");
    const rootModuleMatch = rootGoModContent.match(/^module\s+(\S+)/m);
    if (!rootModuleMatch) {
        throw new Error(
            `[createPlugins] Cannot find module declaration in ${rootGoMod}`,
        );
    }
    const rootModuleName = rootModuleMatch[1];
    const uniqueRootModule = `${rootModuleName}-${id}`;
    console.log(
        `[createPlugins] Rewriting root module: ${rootModuleName} → ${uniqueRootModule}`,
    );
    rewriteModuleName(pluginDir, rootModuleName, uniqueRootModule);

    // 4. Regenerate go.sum files – the rename invalidates existing checksum entries.
    //    Run go mod tidy in validationpkg submodule first, then the root module.
    //    The actual .so compilation happens inside Docker so Go versions match exactly.
    const validationpkgDir = path.join(
        pluginDir,
        "ondc-validator",
        "validationpkg",
    );
    console.log(`[createPlugins] Running go mod tidy in validationpkg ...`);
    execSync("go mod tidy", {
        cwd: validationpkgDir,
        stdio: "inherit",
        shell: "/bin/bash",
        env: {
            ...process.env,
            CGO_ENABLED: "1",
            GONOSUMCHECK: "*",
            GONOSUMDB: "*",
            GOFLAGS: "-mod=mod",
        },
    });

    console.log(`[createPlugins] Running go mod tidy in plugin root ...`);
    execSync("go mod tidy", {
        cwd: pluginDir,
        stdio: "inherit",
        shell: "/bin/bash",
        env: {
            ...process.env,
            CGO_ENABLED: "1",
            GONOSUMCHECK: "*",
            GONOSUMDB: "*",
            GOFLAGS: "-mod=mod",
        },
    });

    console.log(`✅ Assembled ${id} (will be built inside Docker)`);
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

    // .so compilation happens inside Docker so Go versions match exactly.
    console.log(`✅ Assembled schemavalidator (will be built inside Docker)`);
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

    console.log(
        "[createPlugins] All plugins assembled (Docker will build the .so files).",
    );
}
