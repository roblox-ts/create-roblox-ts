import path from "path";

export const PACKAGE_ROOT = path.join(__dirname, "..");

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
export const VERSION: string = require(path.join(PACKAGE_ROOT, "package.json")).version;

export const RBXTS_SCOPE = "@rbxts";
export const TEMPLATES_DIR = path.join(PACKAGE_ROOT, "templates");
