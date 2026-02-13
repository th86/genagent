# GenAgent 🦐

A general-purpose AI agent with extensible skills, browser control, and multiple interface support (CLI + Telegram).

## Features

- **🤖 AI-powered** - Powered by NVIDIA NIM LLM (Llama 3.3)
- **💬 Multiple Interfaces** - CLI and Telegram bot support
- **🌐 Browser Automation** - Headless/visible Chrome control
- **📦 Extensible Skills** - Add new skills via `skill.md` files
- **💾 Persistent History** - Markdown-based conversation storage

## Quick Start

```bash
# Clone and install
npm install

# Configure
cp env.example .env
# Edit .env with your API keys

# Run CLI
npm run cli

# Or run Telegram bot
npm start
```

## Configuration

Edit `config.yaml` to customize:

```yaml
llm:
  model: meta/llama-3.3-70b-instruct
  
browser:
  mode: headless  # or "visible"
  
persistence:
  enabled: true
```

## Commands

### CLI Mode
- `help` - Show commands
- `skills` - List skills
- `open <url>` - Browse websites
- `screenshot` - Take screenshot
- `exit` - Quit

### Telegram
- `/start` - Welcome message
- `/help` - Commands list
- `/skills` - Available skills
- `/open <url>` - Open website

## Adding Skills

Create `skills/your-skill.md`:

```markdown
---
name: My Skill
description: What it does
priority: 10

triggers:
  - keyword1
  - keyword2
---

## Capabilities
- name: do_something
  description: Does something

## System Prompt
You are an expert in...
```

## Project Structure

```
genagent/
├── src/
│   ├── core/          # Agent & skill manager
│   ├── interfaces/    # CLI & Telegram
│   ├── browser/      # Puppeteer service
│   └── llm/          # NVIDIA client
├── skills/           # Skill definitions
└── config.yaml       # Configuration
```

## Tech Stack

- Node.js 20+
- grammY (Telegram)
- Puppeteer (Browser)
- Inquirer (CLI)
- NVIDIA NIM (LLM)

## License

MIT
