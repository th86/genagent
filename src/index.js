import TelegramBotInterface from './interfaces/telegram/index.js';
import agent from './core/agent.js';
import scheduler from './core/scheduler.js';
import browserService from './browser/agent-browser-service.js';
import codeModifier from './core/code-modifier.js';
import config from './utils/config.js';
import logger from './utils/logger.js';

/**
 * Main application entry point for GenAgent
 */
class GenAgent {
  constructor() {
    this.telegramBot = null;
    this.running = false;
    this.startupVerificationFailed = false;
  }

  /**
   * Verify startup is valid after code changes
   */
  async verifyStartup() {
    logger.info('🔍 Verifying startup integrity...');
    
    const result = await codeModifier.verifyStartup();
    
    if (!result.valid) {
      logger.error(`❌ Startup verification failed: ${result.error}`);
      logger.info('♻️ Attempting automatic rollback...');
      
      const reverted = codeModifier.revertPending();
      
      if (reverted) {
        console.log(`
⚠️  CODE MODIFICATION FAILED

The agent detected that the previous modification caused issues.
✅ Automatically reverted to previous working version.

Would you like to:
1. Try a different approach
2. Report the issue for debugging
3. Continue with the reverted version

Please describe what you'd like to do next.
        `);
        
        this.startupVerificationFailed = true;
        return false;
      } else {
        console.log(`
❌ CRITICAL: Could not revert to previous version!

The backup system could not restore the previous working state.
Please manually check the data/backups directory.
        `);
        process.exit(1);
      }
    }
    
    logger.success('✅ Startup verification passed');
    return true;
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
    
    // Verify startup if there are pending changes
    if (codeModifier.getPendingChanges()) {
      const verified = await this.verifyStartup();
      if (!verified) {
        return;
      }
    }
    
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
  
  // Try to restore backup on failure
  if (codeModifier.getPendingChanges()) {
    console.log('\n♻️ Attempting automatic rollback due to startup failure...');
    codeModifier.revertPending();
  }
  
  process.exit(1);
});

export default app;