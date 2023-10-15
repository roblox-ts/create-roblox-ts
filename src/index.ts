#!/usr/bin/env node

import yargs from "yargs";

import { PACKAGE_ROOT, VERSION } from "./constants";
import { InitError } from "./errors/InitError";
import { LoggableError } from "./errors/LoggableError";

yargs
	// help
	.usage("Create a roblox-ts project from a template")
	.help("help")
	.alias("h", "help")
	.describe("help", "show help information")

	// version
	.version(VERSION)
	.alias("v", "version")
	.describe("version", "show version information")

	// commands
	.commandDir(`${PACKAGE_ROOT}/out/commands`)

	// options
	.recommendCommands()
	.strict()
	.wrap(yargs.terminalWidth())

	// execute
	.fail(str => {
		if (str) {
			new InitError(str).log();
			process.exit(1);
		}
	})
	.parseAsync()
	.catch(e => {
		process.exitCode = 1;
		if (e instanceof LoggableError) {
			e.log();
		} else {
			throw e;
		}
	});
