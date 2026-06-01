export function printHelp(): void {
	console.log("用法: dfo-login <command> [options]");
	console.log("");
	console.log("命令:");
	console.log(
		"  init        交互式配置数据库连接与 RSA 私钥,产物在 ~/.dfo-login/ 目录下",
	);
	console.log(
		"  signup      交互式注册新账户(账户名/密码/QQ/初始点券/初始代币)",
	);
	console.log(
		"  login      交互式登录账户并打印完整游戏 token,自动写入 tokens.json",
	);
	console.log(
		"  lookup      [账户名] 查询已记录的 token。无参时列出所有账户名",
	);
	console.log("  help        显示帮助信息");
	console.log("");
	console.log(
		"无显式子命令时:若 db_config.json 不存在则自动进入 init,否则打印本帮助。",
	);
}
