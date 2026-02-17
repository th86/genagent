import TelegramBotInterface from './interfaces/telegram/index.js';
import agent from './core/agent.js';
import scheduler from './core/scheduler.js';
import browserService from './browser/puppeteer-service.js';
import config from './utils/config.js';
import logger from './utils/logger.js';

/**
 * Main application entry point for GenAgent
 */
class GenAgent {
  constructor() {
    this.telegramBot = null;
    this.running = false;
  }

  /**
   * Initialize the application
   */
  async initialize() {
    logger.startup('GenAgent');

    // Initialize agent
    await agent.initialize();

    // Start Telegram bot if enabled
    if (config.interfaces.telegram?.enabled) {
      this.telegramBot = new TelegramBotInterface();
      try {
        await this.telegramBot.start();
      } catch (error) {
        logger.error('Failed to start Telegram bot:', error);
      }
    }

    logger.ready('GenAgent');
  }

  /**
   * Start the application
   */
  async start() {
    if (this.running) {
      logger.warn('GenAgent is already running');
      return;
    }

    // Setup handlers FIRST (before any async operations)
    this.setupGracefulShutdown();
    
    await this.initialize();
    this.running = true;

    // Show startup info
    console.log(`
🤖 GenAgent is running! 

📱 Interfaces:
${config.interfaces.telegram?.enabled ? '  ✅ Telegram bot' : '  ❌ Telegram bot (disabled)'}
${config.interfaces.cli?.enabled ? '  ✅ CLI (run npm run cli)' : '  ❌ CLI (disabled)'}

🌐 Browser: ${config.browser.enabled ? `${config.browser.mode} mode` : 'disabled'}

💾 Persistence: ${config.persistence.enabled ? 'enabled' : 'disabled'}

🛑 Press Ctrl+C to stop
    `);
  }

  /**
   * Setup graceful shutdown
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`\n🛑 Received ${signal}. Shutting down...`);
      
      this.running = false;
      
      if (this.telegramBot) {
        this.telegramBot.stop();
      }
      
      if (browserService.isReady()) {
        await browserService.close();
      }
      
      scheduler.shutdown();
      
      logger.success('GenAgent stopped');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Start the application
const app = new GenAgent();
app.start().catch(error => {
  console.error('Failed to start GenAgent:', error);
  process.exit(1);
});

export default app;