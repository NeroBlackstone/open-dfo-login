import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { PRIVATE_KEY_PATH, TOKENS_PATH } from "./constants.ts";
import { ensureConfigDir } from "./db-config.ts";

/**
 * 从 ~/.dfo-login/tokens.json 加载 (accountName -> token) 映射。
 * 文件不存在或解析失败时返回空对象,绝不抛错。
 */
export function loadTokenMap(): Record<string, string> {
	if (!existsSync(TOKENS_PATH)) return {};
	try {
		const parsed = JSON.parse(readFileSync(TOKENS_PATH, "utf-8")) as Record<
			string,
			unknown
		>;
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === "string") out[k] = v;
		}
		return out;
	} catch (error) {
		console.warn(`token 记录文件 ${TOKENS_PATH} 解析失败,按空记录处理:`, error);
		return {};
	}
}

/** 将 (accountName -> token) 映射写回 ~/.dfo-login/tokens.json。 */
export function saveTokenMap(map: Record<string, string>): void {
	ensureConfigDir();
	writeFileSync(TOKENS_PATH, JSON.stringify(map, null, "\t"), "utf-8");
}

/** 记录一个账户最近一次成功登录的 token (覆盖旧值)。 */
export function recordToken(accountName: string, token: string): void {
	const map = loadTokenMap();
	map[accountName] = token;
	saveTokenMap(map);
}

/**
 * 从 ~/.dfo-login/private_key.pem 加载 RSA 私钥。
 * 文件不存在或为空时抛出明确错误 —— 不提供任何兜底默认。
 */
export function loadPrivateKey(): string {
	if (!existsSync(PRIVATE_KEY_PATH)) {
		throw new Error(
			`未配置 RSA 私钥: ${PRIVATE_KEY_PATH} 不存在。请先运行 dfo-login init 设置。`,
		);
	}
	const content = readFileSync(PRIVATE_KEY_PATH, "utf-8").trim();
	if (!content) {
		throw new Error(
			`RSA 私钥文件为空: ${PRIVATE_KEY_PATH}。请重新运行 dfo-login init 设置。`,
		);
	}
	return content;
}

/** 将 PEM 内容写入私钥文件,权限设为 0600。 */
export function writePrivateKey(pem: string): void {
	ensureConfigDir();
	writeFileSync(PRIVATE_KEY_PATH, `${pem}\n`, "utf-8");
	chmodSync(PRIVATE_KEY_PATH, 0o600);
}

/** 判断私钥文件是否已存在且非空。 */
export function hasPrivateKey(): boolean {
	return (
		existsSync(PRIVATE_KEY_PATH) &&
		readFileSync(PRIVATE_KEY_PATH, "utf-8").trim().length > 0
	);
}
