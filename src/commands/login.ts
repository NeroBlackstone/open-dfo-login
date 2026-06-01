import { loginAccount } from "../auth.ts";
import { TOKENS_PATH } from "../constants.ts";
import { readLineHidden, readLinePlain } from "../prompts.ts";
import { recordToken } from "../storage.ts";

/**
 * dfo-login login: 交互式登录已有账户,成功后打印完整游戏 token。
 */
export async function loginCommand(): Promise<void> {
	console.log("=== 账户登录 (login) ===");

	const accountName = (await readLinePlain("账户名: ")).trim();
	const password = (await readLineHidden("密码: ")).trim();

	if (!accountName || !password) {
		console.error("账户名和密码不能为空。");
		process.exit(1);
	}

	const result = await loginAccount(accountName, password);

	if (result.stat === 1 && result.token) {
		console.log(`\n✓ ${result.info}`);
		console.log("token:");
		console.log(result.token);

		recordToken(accountName, result.token);
		console.log(`\n(已记录到 ${TOKENS_PATH},可用 dfo-login lookup 查询)`);

		console.log("\n--- 使用提示 ---");
		console.log("Windows:  dnf.exe <token>");
		console.log("Linux:    wine dnf.exe <token>");
		console.log("将上面 token 替换为尖括号里的实际 token 后,粘贴到对应终端执行即可登录游戏。");
	} else {
		console.error(`\n✗ 登录失败: ${result.info}`);
		process.exit(1);
	}
}
