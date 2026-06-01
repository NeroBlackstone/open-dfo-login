#!/usr/bin/env bun
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./src/main.ts";

/**
 * 判断当前文件是否被作为入口运行 (而非被 import)。
 * 必须定义在 index.ts 自身 —— 函数体内的 `import.meta.url` 才会指向入口文件,
 * 而不是它所 import 的其他模块。
 */
function isMainModule(): boolean {
	if (!process.argv[1]) return false;
	try {
		const mainPath = resolve(process.argv[1]);
		const modulePath = resolve(fileURLToPath(import.meta.url));
		return mainPath === modulePath;
	} catch {
		return false;
	}
}

if (isMainModule()) {
	process.exit(await main(process.argv));
}
