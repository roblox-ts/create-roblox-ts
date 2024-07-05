import { spawn } from "child_process";
import fs from "fs-extra";
import kleur from "kleur";
import { lookpath } from "lookpath";
import path from "path";
import prompts from "prompts";
import yargs from "yargs";

import { RBXTS_SCOPE, TEMPLATES_DIR } from "../constants";
import { InitError } from "../errors/InitError";
import { benchmark } from "../util/benchmark";

interface InitOptions {
	compilerVersion?: string;
	dir?: string;
	yes?: boolean;
	git?: boolean;
	eslint?: boolean;
	prettier?: boolean;
	vscode?: boolean;
	packageManager?: PackageManager;
	skipBuild?: boolean;
}

enum InitMode {
	None = "none",
	Game = "game",
	Place = "place",
	Model = "model",
	Plugin = "plugin",
	Package = "package",
}

enum PackageManager {
	NPM = "npm",
	Yarn = "yarn",
	PNPM = "pnpm",
}

interface PackageManagerCommands {
	init: string;
	devInstall: string;
	build: string;
}

const packageManagerCommands: {
	[K in PackageManager]: PackageManagerCommands;
} = {
	[PackageManager.NPM]: {
		init: "npm init -y",
		devInstall: "npm install --silent -D",
		build: "npm run build",
	},
	[PackageManager.Yarn]: {
		init: "yarn init -y",
		devInstall: "yarn add --silent -D",
		build: "yarn run build",
	},
	[PackageManager.PNPM]: {
		init: "pnpm init",
		devInstall: "pnpm install --silent -D",
		build: "pnpm run build",
	},
};

function cmd(cmdStr: string, cwd: string) {
	return new Promise<string>((resolve, reject) => {
		const [command, ...args] = cmdStr.split(" ");
		const childProcess = spawn(command, args, { cwd, shell: true });
		let output = "";
		childProcess.stdout.on("data", data => (output += data));
		childProcess.stderr.on("data", data => (output += data));
		childProcess.on("close", code =>
			code === 0
				? resolve(output)
				: reject(new InitError(`Command "${cmdStr}" exited with code ${code}\n\n${output}`)),
		);
		childProcess.on("error", reject);
	});
}

const GIT_IGNORE = ["/node_modules", "/out", "/include", "*.tsbuildinfo"];

async function init(argv: yargs.Arguments<InitOptions>, initMode: InitMode) {
	const compilerVersion = argv.compilerVersion;

	const { dir = argv.dir } = await prompts(
		[
			{
				type: () => argv.dir === undefined && "text",
				name: "dir",
				message: "Project directory",
			},
		],
		{ onCancel: () => process.exit(1) },
	);

	const cwd = path.resolve(dir);
	if (!(await fs.pathExists(cwd))) {
		await fs.ensureDir(cwd);
	}

	if (!(await fs.stat(cwd)).isDirectory()) {
		throw new InitError(`${cwd} is not a directory!`);
	}

	// Detect if there are any additional package managers
	// We don't need to prompt the user to use additional package managers if none are installed

	// Although npm is installed by default, it can be uninstalled
	// and replaced by another manager, so check for it to make sure
	const [npmAvailable, pnpmAvailable, yarnAvailable, gitAvailable] = (
		await Promise.allSettled(["npm", "pnpm", "yarn", "git"].map(v => lookpath(v)))
	).map(v => (v.status === "fulfilled" ? v.value !== undefined : true));

	const packageManagerExistance: { [K in PackageManager]: boolean } = {
		[PackageManager.NPM]: npmAvailable,
		[PackageManager.PNPM]: pnpmAvailable,
		[PackageManager.Yarn]: yarnAvailable,
	};

	const packageManagerCount = Object.values(packageManagerExistance).filter(exists => exists).length;

	const {
		template = initMode,
		git = argv.git ?? (argv.yes && gitAvailable) ?? false,
		eslint = argv.eslint ?? argv.yes ?? false,
		prettier = argv.prettier ?? argv.yes ?? false,
		vscode = argv.vscode ?? argv.yes ?? false,
		packageManager = argv.packageManager ?? PackageManager.NPM,
	}: {
		template: InitMode;
		git: boolean;
		eslint: boolean;
		prettier: boolean;
		vscode: boolean;
		packageManager: PackageManager;
	} = await prompts(
		[
			{
				type: () => initMode === InitMode.None && "select",
				name: "template",
				message: "Select template",
				choices: [InitMode.Game, InitMode.Model, InitMode.Plugin, InitMode.Package].map(value => ({
					title: value,
					value,
				})),
				initial: 0,
			},
			{
				type: () => argv.git === undefined && argv.yes === undefined && gitAvailable && "confirm",
				name: "git",
				message: "Configure Git",
				initial: true,
			},
			{
				type: () => argv.eslint === undefined && argv.yes === undefined && "confirm",
				name: "eslint",
				message: "Configure ESLint",
				initial: true,
			},
			{
				type: () => argv.prettier === undefined && argv.yes === undefined && "confirm",
				name: "prettier",
				message: "Configure Prettier",
				initial: true,
			},
			{
				type: () => argv.vscode === undefined && argv.yes === undefined && "confirm",
				name: "vscode",
				message: "Configure VSCode Project Settings",
				initial: true,
			},
			{
				type: () =>
					argv.packageManager === undefined && packageManagerCount > 1 && argv.yes === undefined && "select",
				name: "packageManager",
				message: "Multiple package managers detected. Select package manager:",
				choices: Object.entries(PackageManager)
					.filter(([, packageManager]) => packageManagerExistance[packageManager])
					.map(([managerDisplayName, managerEnum]) => ({
						title: managerDisplayName,
						value: managerEnum,
					})),
			},
		],
		{ onCancel: () => process.exit(1) },
	);

	const paths = {
		packageJson: path.join(cwd, "package.json"),
		packageLockJson: path.join(cwd, "package-lock.json"),
		tsconfig: path.join(cwd, "tsconfig.json"),
		gitignore: path.join(cwd, ".gitignore"),
		eslintrc: path.join(cwd, ".eslintrc"),
		prettierrc: path.join(cwd, ".prettierrc"),
		settings: path.join(cwd, ".vscode", "settings.json"),
		extensions: path.join(cwd, ".vscode", "extensions.json"),
	};

	const templateDir = path.join(TEMPLATES_DIR, template);

	const pathValues = Object.values(paths);
	for (const fileName of await fs.readdir(templateDir)) {
		pathValues.push(path.join(cwd, fileName));
	}

	const existingPaths = new Array<string>();
	for (const filePath of pathValues) {
		if (filePath && (await fs.pathExists(filePath))) {
			const stat = await fs.stat(filePath);
			if (stat.isFile() || stat.isSymbolicLink() || (await fs.readdir(filePath)).length > 0) {
				existingPaths.push(path.relative(process.cwd(), filePath));
			}
		}
	}

	if (existingPaths.length > 0) {
		const pathInfo = existingPaths.map(v => `  - ${kleur.yellow(v)}\n`).join("");
		throw new InitError(`Cannot initialize project, process could overwrite:\n${pathInfo}`);
	}

	const selectedPackageManager = packageManagerCommands[packageManager];

	await benchmark("Initializing package.json..", async () => {
		await cmd(selectedPackageManager.init, cwd);
		const pkgJson = await fs.readJson(paths.packageJson);
		pkgJson.scripts = {
			build: "rbxtsc",
			watch: "rbxtsc -w",
		};
		pkgJson.devDependencies = {
			// Special-cased here to set the version spec to "latest"
			// Other dependencies are installed via the shell below
			"@rbxts/types": "latest"
		};
		if (template === InitMode.Package) {
			pkgJson.name = RBXTS_SCOPE + "/" + pkgJson.name;
			pkgJson.main = "out/init.lua";
			pkgJson.types = "out/index.d.ts";
			pkgJson.files = ["out", "!**/*.tsbuildinfo"];
			pkgJson.publishConfig = { access: "public" };
			pkgJson.scripts.prepublishOnly = selectedPackageManager.build;
		}
		await fs.outputFile(paths.packageJson, JSON.stringify(pkgJson, null, 2));
	});

	if (git) {
		await benchmark("Initializing Git..", async () => {
			try {
				await cmd("git init", cwd);
			} catch (error) {
				if (!(error instanceof Error)) throw error;
				throw new Error(
					`${error.message}\nDo you not have Git installed? Git CLI is required to use Git functionality. If you do not wish to use Git, answer no to "Configure Git".`,
				);
			}
			await fs.outputFile(paths.gitignore, GIT_IGNORE.join("\n") + "\n");
		});
	}

	await benchmark("Installing dependencies..", async () => {
		const devDependencies = [
			"roblox-ts" + (compilerVersion ? `@${compilerVersion}` : ""),
			"@rbxts/compiler-types" + (compilerVersion ? `@compiler-${compilerVersion}` : ""),
			"typescript",
		];

		if (prettier) {
			devDependencies.push("prettier");
		}

		if (eslint) {
			devDependencies.push(
				"eslint",
				"@typescript-eslint/eslint-plugin",
				"@typescript-eslint/parser",
				"eslint-plugin-roblox-ts",
			);
			if (prettier) {
				devDependencies.push("eslint-config-prettier", "eslint-plugin-prettier");
			}
		}

		await cmd(`${selectedPackageManager.devInstall} ${devDependencies.join(" ")}`, cwd);
	});

	if (eslint) {
		await benchmark("Configuring ESLint..", async () => {
			const eslintConfig = {
				parser: "@typescript-eslint/parser",
				parserOptions: {
					jsx: true,
					useJSXTextNode: true,
					ecmaVersion: 2018,
					sourceType: "module",
					project: "./tsconfig.json",
				},
				ignorePatterns: ["/out"],
				plugins: ["@typescript-eslint", "roblox-ts"],
				extends: [
					"eslint:recommended",
					"plugin:@typescript-eslint/recommended",
					"plugin:roblox-ts/recommended",
				],
				rules: {} as { [index: string]: unknown },
			};

			if (prettier) {
				eslintConfig.plugins.push("prettier");
				eslintConfig.extends.push("plugin:prettier/recommended");
				eslintConfig.rules["prettier/prettier"] = "warn";
			}

			await fs.outputFile(paths.eslintrc, JSON.stringify(eslintConfig, undefined, "\t"));
		});
	}

	if (prettier) {
		await benchmark("Configuring prettier..", async () => {
			const prettierConfig = {
				printWidth: 120,
				tabWidth: 4,
				trailingComma: "all",
				useTabs: true,
			};
			await fs.outputFile(paths.prettierrc, JSON.stringify(prettierConfig, undefined, "\t"));
		});
	}

	if (vscode) {
		await benchmark("Configuring vscode..", async () => {
			const extensions = {
				recommendations: ["roblox-ts.vscode-roblox-ts"],
			};
			const settings = {
				"typescript.tsdk": "node_modules/typescript/lib",
				"files.eol": "\n",
			};

			if (eslint) {
				extensions.recommendations.push("dbaeumer.vscode-eslint");
				Object.assign(settings, {
					"[typescript]": {
						"editor.defaultFormatter": "dbaeumer.vscode-eslint",
						"editor.formatOnSave": true,
					},
					"[typescriptreact]": {
						"editor.defaultFormatter": "dbaeumer.vscode-eslint",
						"editor.formatOnSave": true,
					},
					"eslint.run": "onType",
					"eslint.format.enable": true,
				});
			} else if (prettier) {
				// no eslint but still prettier
				extensions.recommendations.push("esbenp.prettier-vscode");
				Object.assign(settings, {
					"[typescript]": {
						"editor.defaultFormatter": "esbenp.prettier-vscode",
						"editor.formatOnSave": true,
					},
					"[typescriptreact]": {
						"editor.defaultFormatter": "esbenp.prettier-vscode",
						"editor.formatOnSave": true,
					},
				});
			}

			await fs.outputFile(paths.extensions, JSON.stringify(extensions, undefined, "\t"));
			await fs.outputFile(paths.settings, JSON.stringify(settings, undefined, "\t"));
		});
	}

	await benchmark("Copying template files..", async () => {
		await fs.copy(templateDir, cwd);
	});

	if (!argv.skipBuild) {
		await benchmark("Compiling..", () => cmd(selectedPackageManager.build, cwd));
	}
}

const GAME_DESCRIPTION = "Generate a Roblox place";
const MODEL_DESCRIPTION = "Generate a Roblox model";
const PLUGIN_DESCRIPTION = "Generate a Roblox Studio plugin";
const PACKAGE_DESCRIPTION = "Generate a roblox-ts npm package";

/**
 * Defines behavior of `rbxtsc init` command.
 */
export = {
	command: ["$0", "init"],
	describe: "Create a project from a template",
	builder: () =>
		yargs
			.option("compilerVersion", {
				string: true,
				describe: "roblox-ts compiler version",
			})
			.check(argv => {
				if (argv.compilerVersion !== undefined && !/^\d+\.\d+\.\d+$/.test(argv.compilerVersion)) {
					throw new InitError(
						"Invalid --compilerVersion. You must specify a version in the form of X.X.X. (i.e. --compilerVersion 1.2.3)",
					);
				}
				return true;
			}, true)
			.option("dir", {
				string: true,
				describe: "Project directory",
			})
			.option("yes", {
				alias: "y",
				boolean: true,
				describe: "Use recommended options",
			})
			.option("git", {
				boolean: true,
				describe: "Configure Git",
			})
			.option("eslint", {
				boolean: true,
				describe: "Configure ESLint",
			})
			.option("prettier", {
				boolean: true,
				describe: "Configure Prettier",
			})
			.option("vscode", {
				boolean: true,
				describe: "Configure VSCode Project Settings",
			})
			.option("packageManager", {
				choices: Object.values(PackageManager),
				describe: "Choose an alternative package manager",
			})
			.option("skipBuild", {
				boolean: true,
				describe: "Do not run build script",
			})

			.command([InitMode.Game, InitMode.Place], GAME_DESCRIPTION, {}, argv => init(argv as never, InitMode.Game))
			.command(InitMode.Model, MODEL_DESCRIPTION, {}, argv => init(argv as never, InitMode.Model))
			.command(InitMode.Plugin, PLUGIN_DESCRIPTION, {}, argv => init(argv as never, InitMode.Plugin))
			.command(InitMode.Package, PACKAGE_DESCRIPTION, {}, argv => init(argv as never, InitMode.Package)),
	handler: argv => init(argv, InitMode.None),
	// eslint-disable-next-line @typescript-eslint/ban-types
} satisfies yargs.CommandModule<{}, InitOptions>;
