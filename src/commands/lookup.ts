import { TOKENS_PATH } from "../constants.ts";
import { loadTokenMap } from "../storage.ts";

/**
 * dfo-login lookup [accountName]
 *  - 不带参数:列出所有已记录 token 的账户名
 *  - 带参数:打印该账户最近一次成功登录的 token
 */
export async function lookupCommand(args: string[]): Promise<void> {
	console.log("=== Token 查询 (lookup) ===");
	const accountName = args[0]?.trim();
	const map = loadTokenMap();
	const names = Object.keys(map).sort();

	if (!accountName) {
		if (names.length === 0) {
			console.log(`(暂无记录。请先运行 dfo-login login 注册 token。)`);
			console.log(`记录文件: ${TOKENS_PATH}`);
			return;
		}
		console.log(`记录文件: ${TOKENS_PATH}`);
		console.log(`共 ${names.length} 条已记录账户:`);
		for (const name of names) {
			console.log(`  ${name}`);
		}
		console.log("\n用 `dfo-login lookup <账户名>` 查看对应 token。");
		return;
	}

	const token = map[accountName];
	if (!token) {
		console.error(`✗ 未找到账户 "${accountName}" 的 token 记录。`);
		if (names.length > 0) {
			console.error(`已记录账户: ${names.join(", ")}`);
		}
		console.error("请先运行 dfo-login login 登录该账户。");
		process.exit(1);
	}

	console.log(`账户: ${accountName}`);
	console.log("token:");
	console.log(token);
	console.log("\n--- 使用提示 ---");
	console.log("Windows:  dnf.exe <token>");
	console.log("Linux:    wine dnf.exe <token>");
	console.log("将上面 token 替换为尖括号里的实际 token 后,粘贴到对应终端执行即可登录游戏。");
}
