import path from "path";
import { OUTPUT_DIR } from "../constant";
import fs from "fs";
import { execSync } from "child_process";

// const buildPath = path.resolve(__dirname, "../../../src/config/build.yaml");
// 	const buildParsed = (await loadAndDereferenceYaml(buildPath)) as any;
// 	const version = buildParsed.info.version as string;
// 	const domain = buildParsed.info.domain as string;
// 	const domainFilename = domain.toLowerCase().replace(":", "_");
// 	const versionFileName = `v${version}`;

async function generateSchemas(
    domain: string,
    version: string,
    domainFilename: string,
    versionFileName: string,
    buildPath: string,
) {
    const outputPath = path.resolve(
        OUTPUT_DIR,
        `temp/schemas/${domainFilename}/${versionFileName}`,
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
