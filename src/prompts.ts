import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { getCurrentDbConfig } from "./db-config.ts";
import type { DatabaseConfig } from "./types.ts";

/**
 * 读取一行可见输入
 */
export async function readLinePlain(question: string): Promise<string> {
	const rl = createInterface({ input: stdin, output: stdout });
	try {
		return await rl.question(question);
	} finally {
		rl.close();
	}
}

/**
 * 读取一行不回显的输入 (TTY 下 raw mode,逐字回显 `*`;非 TTY 回退为普通行读取)
 */
export async function readLineHidden(question: string): Promise<string> {
	if (!stdin.isTTY) {
		return readLinePlain(question);
	}

	process.stdout.write(question);
	stdin.setRawMode(true);
	stdin.resume();
	stdin.setEncoding("utf-8");

	return new Promise<string>((resolve) => {
		let buf = "";
		const onData = (chunk: string) => {
			for (const ch of chunk) {
				if (ch === "\r" || ch === "\n") {
					process.stdout.write("\n");
					stdin.setRawMode(false);
					stdin.pause();
					stdin.removeListener("data", onData);
					resolve(buf);
					return;
				}
				if (ch === "\x03") {
					// Ctrl+C
					process.stdout.write("^C\n");
					stdin.setRawMode(false);
					stdin.pause();
					stdin.removeListener("data", onData);
					process.exit(130);
					return;
				}
				if (ch === "\x7f" || ch === "\b") {
					if (buf.length > 0) {
						buf = buf.slice(0, -1);
						process.stdout.write("\b \b");
					}
				} else {
					buf += ch;
					process.stdout.write("*");
				}
			}
		};
		stdin.on("data", onData);
	});
}

/**
 * 询问一个数据库字段,空回车保留 current (来自当前 dbConfig) 的默认值。
 * hidden=true 时,密码不回显。
 */
export async function askField(
	label: string,
	key: keyof DatabaseConfig,
	options: { hidden?: boolean } = {},
): Promise<string> {
	const current = String(getCurrentDbConfig()[key]);
	const defaultHint = options.hidden
		? "留空保持默认"
		: current.length > 0
			? current
			: "(空)";
	const question = `${label} (${defaultHint}): `;

	const answer = options.hidden
		? await readLineHidden(question)
		: await readLinePlain(question);
	const trimmed = (answer ?? "").trim();
	return trimmed || current;
}

/**
 * 读取一个非负整数输入;留空则用 defaultValue。
 * 严格匹配:拒绝 "012"、"12abc" 这类 parseInt 会吃掉的输入。
 * 无效时打印错误并 `process.exit(1)`,保持原行为。
 */
export async function askNonNegativeInt(
	question: string,
	defaultValue: number,
): Promise<number> {
	const raw = (await readLinePlain(question)).trim();
	if (!raw) return defaultValue;
	const n = Number.parseInt(raw, 10);
	if (!Number.isInteger(n) || n < 0 || String(n) !== raw) {
		console.error(`输入无效 (需要非负整数): ${raw}`);
		process.exit(1);
	}
	return n;
}

/**
 * 询问 yes/no 问题。`defaultYes=true` 时回车等同于 yes,反之亦然。
 * 大小写不敏感;只接受 yes/y 视为肯定。
 */
export async function confirmYesNo(
	question: string,
	defaultYes: boolean,
): Promise<boolean> {
	const hint = defaultYes ? "yes/no, 回车=yes" : "yes/no, 回车=no";
	const answer = (await readLinePlain(`${question} (${hint}): `))
		.trim()
		.toLowerCase();
	if (answer === "") return defaultYes;
	return answer === "yes" || answer === "y";
}
