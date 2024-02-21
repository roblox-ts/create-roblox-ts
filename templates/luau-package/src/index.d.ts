interface Module {
	sayHello: (name: string) => string;
}

declare const Module: Module;

export = Module;
