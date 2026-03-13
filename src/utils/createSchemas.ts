import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { execSync } from "child_process";
import { globSync } from "glob";
import { CONFIG_FOLDER, OUTPUT_DIR } from "../constant";

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

// ---------------------------------------------------------------------------
// generateSchemas – runs the schema.sh script for a single domain/version
// ---------------------------------------------------------------------------

async function generateSchemas(
    domain: string,
    version: string,
    domainFilename: string,
    versionFileName: string,
    buildPath: string,
) {
    const outputPath = path.resolve(
        OUTPUT_DIR,
        `schemas/${domainFilename}/${versionFileName}`,
    );

    console.log(`Generating schemas for ${domain} version ${version}...`);

    if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
    }

    const scriptPath = path.resolve(process.cwd(), "scripts/schema.sh");

    try {
        execSync(`bash ${scriptPath} "${buildPath}" "${outputPath}"`, {
            cwd: process.cwd(),
            stdio: "inherit",
            shell: "/bin/bash",
        });
        console.log(`✅ Schemas generated successfully at ${outputPath}`);
    } catch (error: any) {
        console.error("❌ Schema generation failed!");
        console.error("Error:", error.message);
        throw error;
    }
}

// ---------------------------------------------------------------------------
// createSchemas – discovers all build.yaml OpenAPI specs and calls generateSchemas
// ---------------------------------------------------------------------------

/**
 * Glob-discovers every build.yaml under CONFIG_FOLDER, reads its OpenAPI `info`
 * block to extract domain + version, then calls generateSchemas for each.
 *
 * Domain resolution order:
 *   1. `info.domain` field in the spec (e.g. "ONDC:FIS12")
 *   2. Inferred from the parent folder name  (e.g. fis12 → "ONDC:FIS12")
 */
export async function createSchemas(): Promise<void> {
    const buildFiles = globSync("**/build.yaml", {
        cwd: CONFIG_FOLDER,
        absolute: true,
    });

    if (buildFiles.length === 0) {
        console.warn(
            `[createSchemas] No build.yaml files found under ${CONFIG_FOLDER}`,
        );
        return;
    }

    for (const buildPath of buildFiles) {
        // Read only the first few lines to extract info (specs can be huge)
        const raw = fs.readFileSync(buildPath, "utf8");
        const spec = yaml.load(raw) as OpenApiSpec;

        if (!spec?.info?.version) {
            console.warn(
                `[createSchemas] Skipping ${buildPath} – missing info.version`,
            );
            continue;
        }

        const version = spec.info.version;

        // Resolve domain: from spec or infer from folder name
        let domain: string;
        if (spec.info.domain) {
            domain = spec.info.domain;
        } else {
            // e.g. …/configs/fis12/2.0.0/build.yaml → parent dir of version is "fis12"
            const domainDir = path.basename(
                path.dirname(path.dirname(buildPath)),
            );
            domain = `ONDC:${domainDir.toUpperCase()}`;
            console.warn(
                `[createSchemas] No info.domain in ${buildPath}, inferred domain as "${domain}"`,
            );
        }

        const domainFilename = domain.toLowerCase().replace(":", "_");
        const versionFileName = `v${version}`;

        console.log(
            `[createSchemas] Generating schemas → domain=${domain} version=${version}`,
        );

        await generateSchemas(
            domain,
            version,
            domainFilename,
            versionFileName,
            buildPath,
        );
    }

    console.log("[createSchemas] All schemas generated.");
}
