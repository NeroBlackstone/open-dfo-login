import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseConfig } from "./types.ts";

// 初始化点券和代币数量
export const INIT_CERA: number = 100000;
export const INIT_CERAPOINT: number = 100000;

// 配置文件路径 (~/.dfo-login/)
export const CONFIG_DIR: string = join(homedir(), ".dfo-login");
export const CONFIG_PATH: string = join(CONFIG_DIR, "db_config.json");
export const PRIVATE_KEY_PATH: string = join(CONFIG_DIR, "private_key.pem");
export const TOKENS_PATH: string = join(CONFIG_DIR, "tokens.json");

// 默认数据库配置 (配置文件不存在时使用)
export const DEFAULT_DB_CONFIG: DatabaseConfig = {
	host: "127.0.0.1",
	port: 3000,
	user: "root",
	password: "88888888",
};
