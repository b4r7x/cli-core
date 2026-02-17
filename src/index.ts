export * from "./fs.js";
export * from "./package-manager.js";
export * from "./logger.js";
export * from "./detect.js";
export * from "./commands.js";
export * from "./config.js";
export * from "./registry.js";
export * from "./add-helpers.js";
export * from "./cli.js";

// Re-export common dependencies so consumers don't need to declare them directly
export { Command } from "commander";
export { z } from "zod";
export { default as pc } from "picocolors";
