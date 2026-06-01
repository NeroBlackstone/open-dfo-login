# dfo-login

A [Bun](https://bun.com)-powered CLI for managing accounts on a private DFO server: configure the database, register accounts, log in, and produce a game-client login token.

## Quick start (no install)

If you only have [Bun](https://bun.com) installed, you can run the latest published version directly — no clone, no `bun install`:

```bash
bunx dfo-login --help        # show help
bunx dfo-login init          # configure DB connection + paste RSA private key
bunx dfo-login signup        # register a new account
bunx dfo-login login         # log in, print the game token, cache it
bunx dfo-login lookup        # list cached account names
bunx dfo-login lookup <name> # print the cached token for <name>
```

Pin a specific version if you want reproducible behavior:

```bash
bunx dfo-login@0.1.0 login
```

The first run will create `~/.dfo-login/` for the config, private key, and token cache.

## Requirements

- [Bun](https://bun.com) >= 1.3
- A MySQL instance with the `d_taiwan`, `taiwan_login`, `taiwan_billing`, and `taiwan_cain_2nd` schemas already in place (this tool does not create them)
- The RSA private key (PEM) matching the game server

## Install (local development)

```bash
git clone <repo> && cd open-dfo-login
bun install
```

## Commands

| Command | Description |
| --- | --- |
| `init` | Interactively configure the DB connection and RSA private key; outputs go to `~/.dfo-login/` |
| `signup` | Interactively register a new account (name, password, QQ, initial CERA / CERA POINT) |
| `login` | Interactively log in, print the full game token, append to `tokens.json` |
| `lookup [name]` | Look up a cached token. With no argument, lists all cached account names |
| `help` | Print help |

## Files in `~/.dfo-login/`

```
db_config.json   # DB connection (host/port/user/password)
private_key.pem  # RSA private key, mode 0600
tokens.json      # plaintext (accountName -> token) cache
```

`tokens.json` is a plaintext token cache -- treat it as a credential.

## Security notes

- The private key file is written with `0600` and is only read at login time; it is never printed to the terminal.
- Passwords are MD5-hashed before being sent to the DB, matching the server's stored format. Plaintext passwords are never persisted.
- The game token is printed to stdout and also cached in `tokens.json`. Reuse the cached token via `lookup` rather than logging in again.

## Development

```bash
bunx tsc --noEmit                   # type check
bunx @biomejs/biome check .         # format + lint
```

## License

For personal study of the DFO private server protocol only. Please delete within 24 hours.
