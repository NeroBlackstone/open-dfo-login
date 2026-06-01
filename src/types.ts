// 数据库配置接口
export interface DatabaseConfig {
	host: string;
	port: number;
	user: string;
	password: string;
}

// 登录结果接口
export interface LoginResult {
	stat: number;
	token: string | null;
	info: string;
}

// 注册结果接口
export interface RegisterResult {
	stat: number;
	info: string;
}
