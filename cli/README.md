# ExtremeRouter — AI Gateway Control Plane

**A premium, developer-first local gateway that routes traffic from your AI coding tools to 40+ providers with format translation, fallback, quota tracking, and token savings.**

Connect Claude Code, Codex, Cursor, Antigravity, Copilot, Gemini, OpenCode, Cline, OpenClaw and any OpenAI/Anthropic-compatible client to a single endpoint.

[![npm](https://img.shields.io/npm/v/@rsalmn/extremerouter.svg)](https://www.npmjs.com/package/@rsalmn/extremerouter)
[![Downloads](https://img.shields.io/npm/dm/@rsalmn/extremerouter.svg)](https://www.npmjs.com/package/@rsalmn/extremerouter)
[![License](https://img.shields.io/npm/l/@rsalmn/extremerouter.svg)](https://github.com/rsalmn/extremerouter/blob/main/LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-rsalmn%2Fextremerouter-blue?logo=github)](https://github.com/rsalmn/extremerouter)

[🌐 Repository](https://github.com/rsalmn/extremerouter) • [📦 npm](https://www.npmjs.com/package/@rsalmn/extremerouter)

---

## ⚡ Quick Start

```bash
npm install -g @rsalmn/extremerouter
extremerouter
```

The dashboard opens at `http://localhost:20128`.

**Connect a provider** in `Dashboard → Providers`, then point your tool at:

```
Endpoint: http://localhost:20128/v1
API Key:  [copy from dashboard]
Model:    <provider>/<model>
```

### Run with npx (no install)

```bash
npx @rsalmn/extremerouter
```

### Docker

```bash
docker run -d --name extremerouter -p 20128:20128 \
  -v "$HOME/.extremerouter:/app/data" -e DATA_DIR=/app/data \
  rsalmn/extremerouter:latest
```

---

## 🚀 CLI Options

```bash
extremerouter                  # Start with default settings
extremerouter --port 8080      # Custom port
extremerouter --host 0.0.0.0   # Bind to all interfaces
extremerouter --no-browser     # Don't open browser on start
extremerouter --skip-update    # Skip auto-update check
extremerouter --help           # Show all options
```

**Dashboard**: `http://localhost:20128/dashboard`

---

## 🛠️ Supported Tools

Claude Code • Codex • Cursor • Antigravity • Copilot • Cline • OpenCode • OpenClaw • Gemini CLI • Droid • Roo • Kilo Code • Qwen Code • iFlow • Continue • Aider — and any OpenAI/Anthropic-compatible client.

---

## 💾 Data Location

- **macOS/Linux**: `~/.extremerouter/`
- **Windows**: `%APPDATA%/extremerouter/`
- **Docker**: `/app/data/` (mount `$HOME/.extremerouter` to persist)

> **Upgrading from ExtremeRouter?** The first launch automatically migrates your providers, keys, combos, and settings from `~/.extremerouter` to `~/.extremerouter`. Your old data is left intact so you can roll back.

---

## 📚 Documentation

- **Repository**: https://github.com/rsalmn/extremerouter
- **Issues**: https://github.com/rsalmn/extremerouter/issues

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
