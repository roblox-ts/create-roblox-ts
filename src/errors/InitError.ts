import kleur from "kleur";

import { LoggableError } from "./LoggableError";

export class InitError extends LoggableError {
	constructor(private message: string) {
		super();
	}

	toString() {
		return `create-roblox-ts ${kleur.red("error")}: ${this.message}`;
	}
}
