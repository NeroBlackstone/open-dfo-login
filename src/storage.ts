import {
	chmodSync,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { BACKUPS_DIR, PRIVATE_KEY_PATH, TOKENS_PATH } from "./constants.ts";
import { ensureConfigDir, ensureDir } from "./db-config.ts";
import type { BackupManifest } from "./types.ts";

/**
 * listBackups 扫描结果中每一条:文件元信息 + 解析后的 manifest(若成功)。
 * 损坏/JSON 解析失败的文件 manifest 为 null 并填充 error 字段,
 * 不会向上抛错,让 CLI 友好地继续展示其它有效备份。
 */
export interface BackupListEntry {
	filePath: string;
	fileName: string;
	sizeBytes: number;
	mtime: Date;
	manifest: BackupManifest | null;
	error: string | null;
}

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

/**
 * 把 payload 写入备份文件。
 * 沿用 saveTokenMap 风格 (无 chmod) —— 备份内容是 inventory/skill/quest 等游戏内业务数据,
 * 不含密码/token/私钥等凭据。filePath 的父目录会被自动创建,
 * 这样 restore 命令未来直接复用此函数时不依赖特定目录。
 */
export function saveBackup(filePath: string, payload: unknown): void {
	ensureDir(dirname(filePath));
	writeFileSync(filePath, JSON.stringify(payload, null, "\t"), "utf-8");
}

/**
 * 扫描 dir 下所有 *.json 备份,逐个读取并尝试解析 manifest。
 * 目录不存在时返回空数组;读取或解析失败的文件不抛错,而是以
 * { manifest: null, error: "<message>" } 的形式回填,让 CLI 决定如何提示。
 * 返回顺序按文件名字典序(由调用方按 mtime 排序)。
 */
export function listBackups(dir: string = BACKUPS_DIR): BackupListEntry[] {
	if (!existsSync(dir)) return [];
	const out: BackupListEntry[] = [];
	for (const entryName of readdirSync(dir)) {
		if (!entryName.endsWith(".json")) continue;
		const filePath = join(dir, entryName);
		const stat = statSync(filePath);
		if (!stat.isFile()) continue;

		const base: BackupListEntry = {
			filePath,
			fileName: basename(filePath),
			sizeBytes: stat.size,
			mtime: stat.mtime,
			manifest: null,
			error: null,
		};

		try {
			const raw = readFileSync(filePath, "utf-8");
			const payload = JSON.parse(raw) as { manifest?: unknown };
			if (
				payload &&
				typeof payload === "object" &&
				(payload as { manifest?: unknown }).manifest &&
				typeof (payload as { manifest: { schema_version?: unknown } }).manifest
					.schema_version === "number" &&
				(payload as { manifest: { schema_version: number } }).manifest
					.schema_version === 1
			) {
				base.manifest = (payload as { manifest: BackupManifest }).manifest;
			} else {
				base.error = "manifest 缺失或 schema_version 不为 1";
			}
		} catch (err) {
			base.error = err instanceof Error ? err.message : String(err);
		}
		out.push(base);
	}
	return out;
}
