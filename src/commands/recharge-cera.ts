import mysql from "mysql2/promise";
import { getUidByAccountName } from "../auth.ts";
import { getCurrentDbConfig } from "../db-config.ts";

/**
 * dfo-login recharge-cera <账户名> <金额>: 给指定账户增加点券(cera)。
 * 必传账户名和金额;不在 accounts 表里报错退出。
 */
export async function rechargeCeraCommand(args: string[]): Promise<void> {
	console.log("=== 充值点券 (recharge-cera) ===");

	const accountName = args[0]?.trim();
	if (!accountName) {
		console.error("✗ 请提供账户名。用法: dfo-login recharge-cera <账户名> <金额>");
		process.exit(1);
	}

	const amountStr = args[1]?.trim();
	if (amountStr === undefined || amountStr === "") {
		console.error("✗ 请提供金额。用法: dfo-login recharge-cera <账户名> <金额>");
		process.exit(1);
	}
	const amount = Number(amountStr);
	if (!Number.isFinite(amount) || amount <= 0) {
		console.error(`✗ 无效金额 "${amountStr}",请输入正数。`);
		process.exit(1);
	}

	const uid = await getUidByAccountName(accountName);
	if (uid === null) {
		console.error(
			`✗ 账户 "${accountName}" 不存在。请先运行 dfo-login signup 注册。`,
		);
		process.exit(1);
	}

	let connection: mysql.Connection | null = null;
	try {
		connection = await mysql.createConnection(getCurrentDbConfig());

		const [result] = await connection.execute<mysql.ResultSetHeader>(
			"UPDATE taiwan_billing.cash_cera SET cera = cera + ?, mod_date = NOW() WHERE account = ?",
			[amount, uid],
		);

		if (result.affectedRows === 0) {
			console.error(
				`✗ 账户 "${accountName}" (uid=${uid}) 在 cash_cera 表中无记录,请先用 dfo-login signup 注册。`,
			);
			process.exit(1);
		}

		console.log(`✓ 账户 "${accountName}" (uid=${uid}) 已充值点券 ${amount}`);
	} catch (error) {
		console.error("✗ 充值点券时发生错误,请重试。");
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}
