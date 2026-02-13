import config from './config.js';

/**
 * Simple logging utility for GenAgent
 */
class Logger {
  constructor() {
    this.level = config.logging.level || 'info';
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
  }

  /**
   * Check if should log at this level
   */
  shouldLog(level) {
    return this.levels[level] >= this.levels[this.level];
  }

  /**
   * Format log message
   */
  format(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌'
    }[level] || '📝';

    let logMessage = `${prefix} [${timestamp}] ${message}`;
    if (data) {
      logMessage += ` ${JSON.stringify(data)}`;
    }
    return logMessage;
  }

  /**
   * Debug level logging
   */
  debug(message, data = null) {
    if (this.shouldLog('debug')) {
      console.log(this.format('debug', message, data));
    }
  }

  /**
   * Info level logging
   */
  info(message, data = null) {
    if (this.shouldLog('info')) {
      console.log(this.format('info', message, data));
    }
  }

  /**
   * Warn level logging
   */
  warn(message, data = null) {
    if (this.shouldLog('warn')) {
      console.warn(this.format('warn', message, data));
    }
  }

  /**
   * Error level logging
   */
  error(message, data = null) {
    if (this.shouldLog('error')) {
      console.error(this.format('error', message, data));
    }
  }

  /**
   * Success message
   */
  success(message, data = null) {
    if (this.shouldLog('info')) {
      console.log(`✅ [${new Date().toISOString()}] ${message}`, data || '');
    }
  }

  /**
   * Startup message
   */
  startup(component) {
    this.info(`🚀 Starting ${component}...`);
  }

  /**
   * Ready message
   */
  ready(component) {
    this.success(`✨ ${component} ready!`);
  }
}

export const logger = new Logger();
export default logger;