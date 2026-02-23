# GenAgent 🤖

A general-purpose AI agent with extensible skills, browser control, scheduled tasks, auto-fix capabilities, and multiple interface support (CLI + Telegram).

## Features

- **🤖 AI-powered** - Powered by NVIDIA NIM LLM (Llama 3.3)
- **💬 Multiple Interfaces** - CLI and Telegram bot support
- **🌐 Browser Automation** - Headless/visible Chrome control with actual web page parsing
- **📦 Extensible Skills** - Add new skills via `skill.md` files
- **💾 Persistent History** - Markdown-based conversation storage
- **📅 Scheduled Tasks** - One-time, recurring (cron-like), and heartbeat intervals
- **🔧 Auto-fix** - Automatic problem solving with up to 5 retry attempts
- **🔐 Permission System** - Ask before installing packages or running commands
- **🧬 Self-Modification** - Agent can modify its own code with automatic rollback on failure

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

scheduler:
  enabled: true
  default_max_attempts: 5

permissions:
  enabled: true
```

## Commands

### CLI Mode

**General:**
- `help` - Show all commands
- `skills` - List available skills
- `history` - Show conversation history
- `exit` - Quit

**Browser:**
- `open <url>` - Browse websites (actually parses content)
- `screenshot` - Take screenshot
- `click <element>` - Click element
- `browser visible` / `browser headless` - Switch mode

**Scheduler:**
- `schedule "task name" every 30 minutes` - Create heartbeat task
- `schedule "task name" at 2026-02-20 14:00` - Create one-time task
- `schedule "task name" daily at 9am` - Create daily task
- `schedule "task name" weekly on monday at 9am` - Create weekly task
- `schedules` - List all scheduled tasks
- `schedule run <id>` - Run task immediately
- `schedule stop <id>` - Stop running task
- `schedule delete <id>` - Remove task

**Permissions:**
- `permissions` - List granted permissions
- `pending` - Show pending permission requests
- `allow <id>` - Grant a permission
- `deny <id>` - Deny a permission

**Stop:**
- `stop` / `cancel` / `abort` - Signal stop to running tasks

### Telegram

**General:**
- `/start` - Welcome message
- `/help` - Commands list
- `/skills` - Available skills
- `/settings` - Current settings

**Browser:**
- `/open <url>` - Open website
- `/screenshot` - Take screenshot
- `/browser visible` / `/browser headless` - Switch mode

**Scheduler:**
- `/schedule "task name" every 30 minutes` - Create task
- `/schedules` - List all tasks

**Permissions:**
- `/permissions` - List permissions
- `/pending` - Pending requests
- `/allow <id>` - Grant permission
- `/deny <id>` - Deny permission

**Stop:**
- `/stop` - Stop running tasks

## Scheduled Tasks

GenAgent supports three types of scheduled tasks:

### One-time Tasks
Run once at a specific datetime:
```
schedule "reminder" at 2026-02-20 14:00
```

### Recurring Tasks
Run on a schedule using cron-like syntax:
```
schedule "daily report" daily at 9am
schedule "weekly sync" weekly on monday at 9am
schedule "monthly backup" monthly on 1 at 0:00
```

### Heartbeat Tasks
Run at regular intervals:
```
schedule "health check" every 30 minutes
schedule "monitor" every 1 hour
schedule "backup" every 1 day
```

Tasks persist across restarts and are stored in `data/schedules/`.

## Auto-fix

When the agent encounters errors (missing packages, command not found, permission denied), it can automatically attempt to fix them:

1. **Error Detection** - Analyzes error messages for fixable issues
2. **Solution Suggestion** - Proposes a fix using available skills
3. **Permission Request** - Asks once before attempting to fix
4. **Execution** - Attempts to install packages or run commands
5. **Retry** - Retries up to 5 times if unsuccessful
6. **Stop** - User can stop at any time with `stop` command

The agent supports fixing:
- Missing npm packages (`Cannot find module 'x'`)
- Missing system packages (`command not found`)
- Missing pip packages (`ModuleNotFoundError`)
- Permission errors (`EACCES`)
- Missing folders (`ENOENT`)

## Permission System

GenAgent asks for permission before:
- Installing packages (npm, brew, pip, apt)
- Running shell commands
- Accessing specific folders

Permission types:
- `package_install` - Install npm/brew/pip/apt packages
- `command_run` - Execute shell commands
- `folder_access` - Read/write directories
- `network_access` - Make network requests

Permissions can be:
- `once` - Ask each time
- `always` - Grant permanently

## Self-Modification

GenAgent can modify its own code to add new features or fix issues. This is a powerful capability with built-in safety mechanisms.

### How It Works

1. **Backup First** - Before any modification, a full backup is created
2. **Apply Changes** - The agent can create, update, or delete files in `src/` and `skills/`
3. **Startup Verification** - On next startup, the agent verifies its integrity
4. **Automatic Rollback** - If verification fails, it automatically reverts to the previous version

### Safety Features

- **Directory Restrictions** - Can only modify `src/` and `skills/` directories
- **Backup System** - Keeps up to 10 backups automatically
- **Startup Check** - Validates core files before starting
- **User Prompt** - If something goes wrong, the user is asked what to do next

### What Can Be Modified

- Add new skills (`skills/*.md`)
- Modify existing skills
- Add new modules (`src/**/*.js`)
- Modify existing source files
- Update configuration

### What Cannot Be Modified

- Files outside `src/` and `skills/` (e.g., `node_modules`, `.env`)
- System files or critical configuration

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

### System Skill

A built-in System skill handles package installation and command execution:

```markdown
---
name: System
description: System operations, package installation, and command execution

triggers:
  - install
  - npm
  - brew
  - pip
  - command
  - run
  - execute
---
```

## Project Structure

```
genagent/
├── src/
│   ├── core/           # Agent, scheduler, permissions, autofix
│   ├── interfaces/     # CLI & Telegram
│   ├── browser/        # Puppeteer service
│   └── llm/           # NVIDIA client
├── skills/            # Skill definitions
├── data/              # Sessions, schedules, permissions
├── config.yaml        # Configuration
└── package.json
```

## Tech Stack

- Node.js 20+
- grammY (Telegram)
- Puppeteer (Browser)
- Inquirer (CLI)
- NVIDIA NIM (LLM)
- YAML (Configuration)

## License

MIT
