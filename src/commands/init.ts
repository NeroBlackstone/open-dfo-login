import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import mysql from "mysql2/promise";
import { CONFIG_PATH, PRIVATE_KEY_PATH } from "../constants.ts";
import { saveDbConfig, setCurrentDbConfig } from "../db-config.ts";
import { askField, confirmYesNo } from "../prompts.ts";
import { hasPrivateKey, writePrivateKey } from "../storage.ts";
import type { DatabaseConfig } from "../types.ts";

/**
 * 用给定配置实际连一次数据库。成功返回 null,失败返回错误信息。
 * 用 SELECT 1 作为探活:既能验证 TCP/认证,也能确认服务器可响应。
 */
export async function testDbConnection(
	config: DatabaseConfig,
): Promise<string | null> {
	let connection: mysql.Connection | null = null;
	try {
		connection = await mysql.createConnection(config);
		await connection.query("SELECT 1");
		return null;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return message;
	} finally {
		if (connection) {
			try {
				await connection.end();
			} catch {
				// 关闭时出错也忽略 — 我们只关心测试结果
			}
		}
	}
}

/**
 * dfo-login init: 交互式配置数据库连接,保存到 ~/.dfo-login/db_config.json
 */
export async function initCommand(): Promise<void> {
	console.log("=== 数据库配置初始化 ===");
	console.log(`配置文件路径: ${CONFIG_PATH}`);
	console.log("直接回车即可使用括号中的默认值。");

	const host = await askField("数据库主机地址 (host)", "host");

	const portStr = await askField("数据库端口 (port)", "port");
	const port = Number.parseInt(portStr, 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		console.error(`端口号无效: ${portStr}`);
		process.exit(1);
	}

	const user = await askField("数据库用户名 (user)", "user");
	const password = await askField("数据库密码 (password)", "password", {
		hidden: true,
	});

	const newConfig: DatabaseConfig = { host, port, user, password };

	// 写入前先实际连一次,避免把错的配置落盘导致后续命令都连不上
	console.log("\n正在测试数据库连接...");
	const testError = await testDbConnection(newConfig);
	if (testError) {
		console.error(`✗ 数据库连接测试失败: ${testError}`);
		console.error("  配置可能有误,请检查主机/端口/用户名/密码后重试。");
		const forceSave = await confirmYesNo("是否仍要保存该配置?", false);
		if (!forceSave) {
			console.log("已取消,未写入配置。请重新运行 dfo-login init。");
			process.exit(1);
		}
		console.warn("  警告: 已忽略连接测试失败,继续写入配置。");
	} else {
		console.log("✓ 数据库连接测试成功。");
	}

	saveDbConfig(newConfig);
	console.log(`\n数据库配置已写入 ${CONFIG_PATH}`);

	// 同步更新内存中的 dbConfig,使本进程后续调用也使用新配置
	setCurrentDbConfig(newConfig);

	// 配 RSA 私钥 (粘贴 PEM,无默认)
	await askPrivateKey();
}

/**
 * 从 stdin 读取多行 PEM,直到:
 *  - 出现包含 `-----END` 的行 (自动收尾,这是粘贴 PEM 的正常路径)
 *  - 或 readline 关闭 (用户按 Ctrl+D,用于「跳过」)
 *  - 或 Ctrl+C (取消)
 *
 * 之所以不用 `'end'` 事件:TTY 下粘贴多行 PEM 后,canonical 模式的 Ctrl+D
 * 常被缓冲区里残留的换行吞掉,EOF 事件不触发,看起来就是「无法结束」。
 */
function readStdinToEof(): Promise<string> {
	return new Promise<string>((resolve) => {
		const lines: string[] = [];
		let settled = false;
		const settle = (value: string) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const rl = createInterface({
			input: stdin,
			output: stdout,
			terminal: stdin.isTTY,
		});

		rl.on("line", (line) => {
			lines.push(line);
			if (line.includes("-----END")) {
				settle(lines.join("\n").trim());
				rl.close();
			}
		});

		// Ctrl+D 在 readline 里触发 close
		rl.on("close", () => {
			settle(lines.join("\n").trim());
		});

		// Ctrl+C 直接退
		rl.on("SIGINT", () => {
			process.stdout.write("^C\n");
			rl.close();
			process.exit(130);
		});
	});
}

/**
 * dfo-login init 的私钥步骤: 粘贴/保留 RSA 私钥。
 * - 文件已存在且非空 → 提示「Ctrl+D 保持,粘贴新私钥以覆盖」
 * - 文件不存在或为空 → 提示「未配置 (无默认值),粘贴 PEM 或 Ctrl+D 跳过 (将无法登录)」
 * - 空输入 → 保留现状 / 跳过
 * - 非空输入 → 写入 ~/.dfo-login/private_key.pem 并 chmod 0600
 */
export async function askPrivateKey(): Promise<void> {
	const hasNonEmptyKey = hasPrivateKey();

	if (hasNonEmptyKey) {
		console.log(
			"\nRSA 私钥 (PEM): 当前已配置。\n粘贴完整新PEM私钥文件内容以覆盖(包含 `BEGIN`行 到 `END`行),按 Ctrl+D 保持现状。",
		);
	} else {
		console.log(
			"\nRSA 私钥 (PEM): 当前未配置 (没有默认值)。\n粘贴完整PEM私钥文件内容以设置(包含 `BEGIN`行 到 `END`行),按 Ctrl+D 跳过 (将无法登录)。",
		);
	}

	const raw = await readStdinToEof();
	const trimmed = raw.trim();

	if (!trimmed) {
		console.log(hasNonEmptyKey ? "已保留现有私钥。" : "未设置私钥。");
		return;
	}

	writePrivateKey(trimmed);
	console.log(`私钥已写入 ${PRIVATE_KEY_PATH} (权限 0600)`);
}
