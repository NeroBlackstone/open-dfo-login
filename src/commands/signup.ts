import { registerAccount } from "../auth.ts";
import { INIT_CERA, INIT_CERAPOINT } from "../constants.ts";
import {
	askNonNegativeInt,
	confirmYesNo,
	readLineHidden,
	readLinePlain,
} from "../prompts.ts";

/**
 * dfo-login signup: 交互式注册新账户。逐项询问后打印汇总并要求确认,然后写入数据库。
 */
export async function signupCommand(): Promise<void> {
	console.log("=== 账户注册 (signup) ===");

	const accountName = (
		await readLinePlain("账户名 (4-16 个英文/数字字符),用于登陆: ")
	).trim();
	const password = (await readLineHidden("密码 (6-16 个字符): ")).trim();
	const qq = (await readLinePlain("QQ 号: ")).trim();

	if (!accountName || !password || !qq) {
		console.error("账户名、密码、QQ 号均不能为空。");
		process.exit(1);
	}

	const initCera = await askNonNegativeInt(
		`初始点券(默认 ${INIT_CERA}): `,
		INIT_CERA,
	);
	const initCeraPoint = await askNonNegativeInt(
		`初始代币数量(默认 ${INIT_CERAPOINT}): `,
		INIT_CERAPOINT,
	);

	console.log("\n即将创建账户,确认信息如下:");
	console.log(`  账户名:      ${accountName}`);
	console.log(`  QQ 号:       ${qq}`);
	console.log(`  初始点券数量:        ${initCera}`);
	console.log(`  初始代币数量:  ${initCeraPoint}`);

	const confirmed = await confirmYesNo("确认注册?", true);
	if (!confirmed) {
		console.log("已取消。");
		return;
	}

	const result = await registerAccount(
		accountName,
		password,
		qq,
		initCera,
		initCeraPoint,
	);

	if (result.stat === 1) {
		console.log(`\n${result.info}`);
	} else {
		console.error(`\n${result.info}`);
		process.exit(1);
	}
}
