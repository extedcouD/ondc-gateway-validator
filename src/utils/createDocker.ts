import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "../constant";

// ---------------------------------------------------------------------------
// Paths (all relative to build-output/ which is also the Docker context)
// ---------------------------------------------------------------------------

const BUILD_OUTPUT = path.join(PROJECT_ROOT, "build-output");
const PLUGINS_DIR = path.join(BUILD_OUTPUT, "plugins"); // source trees in (from createPlugins), .so files out
const PLUGIN_CODE_DIR = path.join(BUILD_OUTPUT, "plugin-code"); // source trees moved here
const DOCKERFILE = path.join(BUILD_OUTPUT, "Dockerfile");
const COMPOSEFILE = path.join(BUILD_OUTPUT, "docker-compose.yml");

// ---------------------------------------------------------------------------
// Step 1: splitPlugins
//   • Move full source trees from build-output/plugins/ → build-output/plugin-code/
//   • Strip irrelevant subdirs so each plugin-code/<name>/ contains only what
//     its go build command needs:
//       ondcvalidator_*  →  go.mod  +  ondc-validator/  (with generated validationpkg)
//       schemavalidator  →  go.mod  +  schemavalidator/
//   • plugins/ is left empty – .so files are built inside Docker
// ---------------------------------------------------------------------------

function splitPlugins(): string[] {
    const pluginNames: string[] = [];

    if (!fs.existsSync(PLUGINS_DIR)) {
        console.warn(
            "[createDocker] build-output/plugins/ not found – run createPlugins first",
        );
        return pluginNames;
    }

    // Collect only directories (the full source trees placed by createPlugins)
    const entries = fs
        .readdirSync(PLUGINS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory());

    if (entries.length === 0) {
        console.warn(
            "[createDocker] No plugin source directories found in build-output/plugins/",
        );
        return pluginNames;
    }

    fs.mkdirSync(PLUGIN_CODE_DIR, { recursive: true });

    for (const entry of entries) {
        const srcDir = path.join(PLUGINS_DIR, entry.name);
        const destDir = path.join(PLUGIN_CODE_DIR, entry.name);

        // Move source tree to plugin-code/
        if (fs.existsSync(destDir)) {
            fs.rmSync(destDir, { recursive: true, force: true });
        }
        fs.cpSync(srcDir, destDir, { recursive: true });
        fs.rmSync(srcDir, { recursive: true, force: true });

        // Trim: each dir should only contain what its own go build needs
        if (entry.name === "schemavalidator") {
            // Remove ondc-validator subtree – not needed for schemavalidator build
            const unneeded = path.join(destDir, "ondc-validator");
            if (fs.existsSync(unneeded)) {
                fs.rmSync(unneeded, { recursive: true, force: true });
            }
        } else {
            // ondcvalidator_* – remove schemavalidator subtree
            const unneeded = path.join(destDir, "schemavalidator");
            if (fs.existsSync(unneeded)) {
                fs.rmSync(unneeded, { recursive: true, force: true });
            }
        }

        console.log(`[createDocker] Staged plugin-code/${entry.name}/`);
        pluginNames.push(entry.name);
    }

    return pluginNames;
}

// ---------------------------------------------------------------------------
// Step 2a: generateBuildPluginsScript
//   Writes a buildplugins.sh into plugin-code/ so it is COPY'd into the
//   Docker build stage alongside the source trees and can be run to compile
//   all .so files in one shot with a consistent Go toolchain.
// ---------------------------------------------------------------------------

function generateBuildPluginsScript(pluginNames: string[]): void {
    const buildCalls = pluginNames.map((name) => {
        if (name === "schemavalidator") {
            return `build_plugin "schemavalidator" "schemavalidator" "./schemavalidator/cmd"`;
        }
        // ondcvalidator_* — source is under ondc-validator/cmd
        return `build_plugin "${name}" "${name}" "./ondc-validator/cmd"`;
    });

    const script = [
        `#!/usr/bin/env bash`,
        `set -euo pipefail`,
        ``,
        `# Builds Go plugins (.so) into a specified directory`,
        `#`,
        `# Usage:`,
        `#   ./buildplugins.sh [PLUGINS_DIR]`,
        `#`,
        `# Arguments:`,
        `#   PLUGINS_DIR - Optional. Directory where plugins will be built (default: ./plugins)`,
        ``,
        `ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"`,
        ``,
        `if [[ $# -gt 0 && -n "$1" ]]; then`,
        `\tPLUGINS_DIR="$1"`,
        `\tif [[ "$PLUGINS_DIR" != /* ]]; then`,
        `\t\tPLUGINS_DIR="$ROOT_DIR/$PLUGINS_DIR"`,
        `\tfi`,
        `else`,
        `\tPLUGINS_DIR="$ROOT_DIR/plugins"`,
        `fi`,
        ``,
        `GO_BIN="\${GO:-go}"`,
        `TRIMPATH="\${TRIMPATH:-0}"`,
        ``,
        `mkdir -p "$PLUGINS_DIR"`,
        ``,
        `echo "======================================"`,
        `echo "Building Go Plugins"`,
        `echo "======================================"`,
        `echo "Output directory: $PLUGINS_DIR"`,
        `echo "Go: $($GO_BIN version)"`,
        `echo "Go env: GOOS=$($GO_BIN env GOOS) GOARCH=$($GO_BIN env GOARCH) GOROOT=$($GO_BIN env GOROOT)"`,
        `echo "======================================"`,
        ``,
        `GOOS="$($GO_BIN env GOOS)"`,
        `if [[ "$GOOS" == "windows" ]]; then`,
        `\techo "❌ Go plugins (-buildmode=plugin) are not supported on Windows." >&2`,
        `\texit 1`,
        `fi`,
        ``,
        `build_plugin() {`,
        `\tlocal name="$1"`,
        `\tlocal module_dir="$2"`,
        `\tlocal pkg="$3"`,
        `\tlocal out="$PLUGINS_DIR/\${name}.so"`,
        ``,
        `\techo "==> Building \${name}.so from \${module_dir} (\${pkg})"`,
        `\tif [[ "$TRIMPATH" == "1" ]]; then`,
        `\t\t( cd "$ROOT_DIR/$module_dir" && CGO_ENABLED=1 "$GO_BIN" build -buildmode=plugin -trimpath -o "$out" "$pkg" )`,
        `\telse`,
        `\t\t( cd "$ROOT_DIR/$module_dir" && CGO_ENABLED=1 "$GO_BIN" build -buildmode=plugin -o "$out" "$pkg" )`,
        `\tfi`,
        `\techo "    ✓ Wrote: $out"`,
        `}`,
        ``,
        ...buildCalls,
        ``,
        `echo "======================================"`,
        `echo "✅ Done! Plugins are in: $PLUGINS_DIR"`,
        `echo "======================================"`,
    ].join("\n");

    const scriptPath = path.join(PLUGIN_CODE_DIR, "buildplugins.sh");
    fs.writeFileSync(scriptPath, script, { encoding: "utf8", mode: 0o755 });
    console.log(`[createDocker] Written → plugin-code/buildplugins.sh`);
}

// ---------------------------------------------------------------------------
// Step 2b: generateDockerfile
//   Multi-stage: golang builder runs buildplugins.sh | runtime copies .so in
// ---------------------------------------------------------------------------

function generateDockerfile(): void {
    const dockerfile = [
        `# ── Stage 1 · Build plugins from source ──────────────────────────────────────`,
        `FROM golang:1.25.5 AS plugin-builder`,
        ``,
        `WORKDIR /src`,
        ``,
        `# Copy all plugin source trees and the build script`,
        `COPY plugin-code/ .`,
        ``,
        `RUN mkdir -p /plugins`,
        ``,
        `# Build all plugins with the Go toolchain inside this image`,
        `RUN bash buildplugins.sh /plugins`,
        ``,
        `# ── Stage 2 · Runtime ────────────────────────────────────────────────────────`,
        `FROM ghcr.io/ondc-official/automation-beckn-onix:latest`,
        ``,
        `WORKDIR /workspace/app`,
        ``,
        `# Compiled plugins`,
        `COPY --from=plugin-builder /plugins ./plugins`,
        ``,
        `# JSON schemas generated from OpenAPI specs`,
        `COPY config/schemas ./schemas`,
        ``,
        `# Adapter config`,
        `COPY config/adapter.yaml ./config/adapter.yaml`,
        ``,
        `# Run the onix server`,
        `CMD ["./server", "--config=./config/adapter.yaml"]`,
    ].join("\n");

    fs.writeFileSync(DOCKERFILE, dockerfile, "utf8");
    console.log(`[createDocker] Written → Dockerfile`);
}

// ---------------------------------------------------------------------------
// Step 3: generateCompose
// ---------------------------------------------------------------------------

function generateCompose(): void {
    const compose = [
        `services:`,
        `  onix:`,
        `    build:`,
        `      context: .`,
        `      dockerfile: Dockerfile`,
        `    ports:`,
        `      - "3001:3001"`,
        `    restart: unless-stopped`,
        `    environment:`,
        `      LOG_LEVEL: debug`,
    ].join("\n");

    fs.writeFileSync(COMPOSEFILE, compose, "utf8");
    console.log(`[createDocker] Written → docker-compose.yml`);
}

// ---------------------------------------------------------------------------
// createDocker – main export
// ---------------------------------------------------------------------------

export function createDocker(): void {
    console.log(
        "[createDocker] Splitting plugins into plugin-code/ and plugins/ ...",
    );
    const pluginNames = splitPlugins();

    console.log(
        `[createDocker] Generating buildplugins.sh + Dockerfile for ${pluginNames.length} plugin(s) ...`,
    );
    generateBuildPluginsScript(pluginNames);
    generateDockerfile();

    console.log("[createDocker] Generating docker-compose.yml ...");
    generateCompose();

    console.log("[createDocker] Done.");
    console.log(`\nBuild output structure:`);
    console.log(`  build-output/`);
    console.log(`  ├── Dockerfile`);
    console.log(`  ├── docker-compose.yml`);
    console.log(
        `  ├── plugin-code/         ← trimmed Go source trees (Docker build stage)`,
    );
    pluginNames.forEach((n) => console.log(`  │   └── ${n}/`));
    console.log(
        `  ├── plugins/             ← empty (.so files built inside Docker, not pre-compiled)`,
    );
    console.log(`  └── config/`);
    console.log(`      ├── adapter.yaml`);
    console.log(`      └── temp/schemas/`);
}
