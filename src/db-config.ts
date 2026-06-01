import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import {
	CONFIG_DIR,
	CONFIG_PATH,
	DEFAULT_DB_CONFIG,
} from "./constants.ts";
import type { DatabaseConfig } from "./types.ts";

/**
 * 进程内当前生效的数据库配置。
 * 初始来自 `loadDbConfig()`;`init` 命令写入新配置后,通过 `setCurrentDbConfig` 同步。
 * 集中在一处可变状态,避免散落在各模块顶层。
 */
let currentDbConfig: DatabaseConfig = loadDbConfig();

/** 获取当前数据库配置 (只读语义;实际返回的引用不应被修改)。 */
export function getCurrentDbConfig(): DatabaseConfig {
	return currentDbConfig;
}

/** `init` 命令写入新配置后,同步更新进程内缓存。 */
export function setCurrentDbConfig(config: DatabaseConfig): void {
	currentDbConfig = config;
}

/**
 * 判断 ~/.dfo-login/db_config.json 是否存在
 */
export function hasConfigFile(): boolean {
	return existsSync(CONFIG_PATH);
}

/**
 * 从 ~/.dfo-login/db_config.json 加载数据库配置。
 * 文件不存在或解析失败时,回落到默认配置。
 */
export function loadDbConfig(): DatabaseConfig {
	if (!hasConfigFile()) {
		return { ...DEFAULT_DB_CONFIG };
	}
	try {
		const parsed = JSON.parse(
			readFileSync(CONFIG_PATH, "utf-8"),
		) as Partial<DatabaseConfig>;
		return {
			host:
				typeof parsed.host === "string" ? parsed.host : DEFAULT_DB_CONFIG.host,
			port: Number.isFinite(parsed.port)
				? Number(parsed.port)
				: DEFAULT_DB_CONFIG.port,
			user:
				typeof parsed.user === "string" ? parsed.user : DEFAULT_DB_CONFIG.user,
			password:
				typeof parsed.password === "string"
					? parsed.password
					: DEFAULT_DB_CONFIG.password,
		};
	} catch (error) {
		console.warn(`配置文件 ${CONFIG_PATH} 解析失败,使用默认配置:`, error);
		return { ...DEFAULT_DB_CONFIG };
	}
}

/** 将数据库配置写入 ~/.dfo-login/db_config.json。 */
export function saveDbConfig(config: DatabaseConfig): void {
	ensureConfigDir();
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, "\t"), "utf-8");
}

/** 确保配置目录存在,存在则不创建。多次出现 mkdirSync(recursive:true) 的统一入口。 */
export function ensureConfigDir(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}
