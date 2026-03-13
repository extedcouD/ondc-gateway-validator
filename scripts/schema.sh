#!/bin/bash

BUILD_PATH=$1
OUTPUT_PATH=$2

echo "Running schema generator..."

# Try local installation first
if [ -f "./node_modules/.bin/ondc-code-generator" ]; then
    echo "Using local installation"
    chmod +x ./node_modules/.bin/ondc-code-generator 2>/dev/null || true
    ./node_modules/.bin/ondc-code-generator schema -c "$BUILD_PATH" -o "$OUTPUT_PATH" -f json
else
    echo "Using npx"
    npx --yes ondc-code-generator schema -c "$BUILD_PATH" -o "$OUTPUT_PATH" -f json
fi