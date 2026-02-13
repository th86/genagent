import { Bot } from 'grammy';
import agent from '../../core/agent.js';
import browserService from '../../browser/puppeteer-service.js';
import sessionManager from '../../core/session.js';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

/**
 * Telegram Bot Interface for GenAgent
 */
class TelegramBotInterface {
  constructor() {
    this.bot = null;
  }

  /**
   * Initialize and start the Telegram bot
   */
  async start() {
    const telegramConfig = config.interfaces.telegram;
    
    if (!telegramConfig.enabled) {
      logger.info('Telegram bot is disabled');
      return;
    }

    if (!telegramConfig.bot_token) {
      logger.warn('Telegram bot token not configured');
      return;
    }

    this.bot = new Bot(telegramConfig.bot_token);
    
    this.setupHandlers();
    
    await this.bot.start();
    logger.success('Telegram bot started');
  }

  /**
   * Setup bot command handlers
   */
  setupHandlers() {
    // Start command
    this.bot.command('start', async (ctx) => {
      await this.handleStart(ctx);
    });

    // Help command
    this.bot.command('help', async (ctx) => {
      await this.handleHelp(ctx);
    });

    // Skills command
    this.bot.command('skills', async (ctx) => {
      await this.handleSkills(ctx);
    });

    // Use skill command
    this.bot.command('use', async (ctx) => {
      await this.handleUseSkill(ctx);
    });

    // Browser commands
    this.bot.command('open', async (ctx) => {
      await this.handleBrowserOpen(ctx);
    });

    this.bot.command('screenshot', async (ctx) => {
      await this.handleBrowserScreenshot(ctx);
    });

    this.bot.command('browser', async (ctx) => {
      await this.handleBrowserMode(ctx);
    });

    // Settings command
    this.bot.command('settings', async (ctx) => {
      await this.handleSettings(ctx);
    });

    // Handle text messages
    this.bot.on('message:text', async (ctx) => {
      await this.handleMessage(ctx);
    });

    // Error handler
    this.bot.catch((err) => {
      console.error('Telegram bot error:', err.message || err);
      if (err.ctx?.message?.text) {
        console.error('Failed message:', err.ctx.message.text);
      }
    });
  }

  /**
   * Handle /start command
   */
  async handleStart(ctx) {
    const welcome = `🤖 *Welcome to GenAgent!*

I'm your general-purpose AI agent with extensible skills.

*Available Features:*
• Multiple AI skills via skill.md files
• Browser automation (view & control)
• Persistent conversation history
• Both CLI and Telegram interfaces

*Quick Start:*
• Send any message to chat with AI
• Use /skills to see available skills
• Use /open <url> to browse websites

Type /help for more commands.`;

    await ctx.reply(welcome, { parse_mode: 'Markdown' });
  }

  /**
   * Handle /help command
   */
  async handleHelp(ctx) {
    const help = `📚 *GenAgent Commands:*

/start - Welcome message
/help - Show this message
/skills - List available skills
/use <skill> - Switch to a specific skill

*Browser:*
/open <url> - Open a website
/screenshot - Take a screenshot
/browser visible - Switch to visible mode
/browser headless - Switch to headless mode

*Settings:*
/settings - Configure agent options

*Just send a message to start chatting!*`;

    await ctx.reply(help, { parse_mode: 'Markdown' });
  }

  /**
   * Handle /skills command
   */
  async handleSkills(ctx) {
    const skills = agent.getSkills();
    
    let message = '📦 *Available Skills:*\n\n';
    
    for (const skill of skills) {
      message += `• *${skill.name}*\n`;
      message += `  ${skill.description}\n\n`;
    }
    
    await ctx.reply(message, { parse_mode: 'Markdown' });
  }

  /**
   * Handle /use command
   */
  async handleUseSkill(ctx) {
    const skillName = ctx.message.text.replace('/use', '').trim();
    
    if (!skillName) {
      await ctx.reply('Please specify a skill name.\nUsage: /use <skill-name>');
      return;
    }

    const success = agent.setSkill(skillName);
    
    if (success) {
      await ctx.reply(`✅ Now using skill: ${skillName}`);
    } else {
      await ctx.reply(`❌ Skill not found: ${skillName}\nUse /skills to see available skills.`);
    }
  }

  /**
   * Handle browser open command
   */
  async handleBrowserOpen(ctx) {
    const url = ctx.message.text.replace('/open', '').trim();
    
    if (!url) {
      await ctx.reply('Please provide a URL.\nUsage: /open https://example.com');
      return;
    }

    // Add https if missing
    let fullUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      fullUrl = 'https://' + url;
    }

    await ctx.reply('🌐 Opening website...');

    const result = await browserService.open(fullUrl);
    
    if (result.success) {
      await ctx.reply(`✅ Opened: ${result.title}\n${result.url}`);
    } else {
      await ctx.reply(`❌ Failed to open: ${result.error}`);
    }
  }

  /**
   * Handle screenshot command
   */
  async handleBrowserScreenshot(ctx) {
    await ctx.reply('📸 Taking screenshot...');

    const result = await browserService.screenshot();
    
    if (result.success) {
      await ctx.replyWithPhoto(result.filepath);
      await ctx.reply(`📁 Saved: ${result.filename}`);
    } else {
      await ctx.reply(`❌ Screenshot failed: ${result.error}`);
    }
  }

  /**
   * Handle browser mode command
   */
  async handleBrowserMode(ctx) {
    const mode = ctx.message.text.replace('/browser', '').trim();
    
    if (!mode || !['visible', 'headless'].includes(mode)) {
      await ctx.reply('Please specify mode: /browser visible or /browser headless');
      return;
    }

    await ctx.reply(`🔄 Switching to ${mode} mode...`);

    const result = await browserService.setMode(mode);
    
    if (result.success) {
      await ctx.reply(`✅ Browser mode set to: ${mode}`);
    } else {
      await ctx.reply(`❌ Failed to change mode: ${result.error}`);
    }
  }

  /**
   * Handle /settings command
   */
  async handleSettings(ctx) {
    const settings = `⚙️ *Current Settings:*

*Browser:*
• Mode: ${config.browser.mode}
• Enabled: ${config.browser.enabled}

*Persistence:*
• Enabled: ${config.persistence.enabled}
• Storage: ${config.persistence.storage}

*Skills:*
• Default: ${config.skills.default_skill}
• Priority Mode: ${config.skills.priority?.mode}

Use /browser visible or /browser headless to change browser mode.`;

    await ctx.reply(settings, { parse_mode: 'Markdown' });
  }

  /**
   * Handle incoming text messages
   */
  async handleMessage(ctx) {
    const message = ctx.message.text;
    const userId = ctx.from.id;

    // Send "typing" indicator (use correct API)
    try {
      await ctx.api.sendChatAction(userId, 'typing');
    } catch (e) {
      // Ignore if typing action fails
    }

    try {
      // Get session context
      const sessionId = `telegram_${userId}`;
      const history = sessionManager.getHistory(sessionId, 10);

      // Process message through agent
      const result = await agent.processMessage(message, { context: history });

      // Handle skill selection needed
      if (result?.needsChoice) {
        await this.handleSkillSelection(ctx, result.skills);
        return;
      }

      // Send response
      if (result?.error) {
        await ctx.reply(`❌ Error: ${result.error}`);
      } else if (result?.response) {
        await ctx.reply(result.response);
        
        // Save to history
        try {
          sessionManager.addMessage(sessionId, 'user', message, result.skill);
          sessionManager.addMessage(sessionId, 'assistant', result.response, result.skill);
        } catch (histError) {
          console.error('Failed to save history:', histError.message);
        }
      } else {
        await ctx.reply('⚠️ No response received. Please try again.');
      }

    } catch (error) {
      console.error('Message handling error:', error.message);
      await ctx.reply('❌ An error occurred while processing your message.');
    }
  }

  /**
   * Handle skill selection with inline keyboard
   */
  async handleSkillSelection(ctx, skills) {
    const buttons = skills.map(s => [
      { text: `${s.name} (${s.confidence})`, callback_data: `skill:${s.name}` }
    ]);
    
    await ctx.reply(
      '🔍 Multiple skills match. Choose one:',
      {
        reply_markup: {
          inline_keyboard: buttons
        }
      }
    );
  }

  /**
   * Stop the bot
   */
  stop() {
    if (this.bot) {
      this.bot.stop();
      logger.info('Telegram bot stopped');
    }
  }
}

export default TelegramBotInterface;