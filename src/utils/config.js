import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration loader for GenAgent
 */
class Config {
  constructor() {
    this.config = {};
    this.loadConfig();
  }

  /**
   * Load configuration from YAML and environment
   */
  loadConfig() {
    const configPath = join(__dirname, '../../config.yaml');
    
    if (existsSync(configPath)) {
      const yamlContent = readFileSync(configPath, 'utf8');
      this.config = parse(yamlContent) || {};
    } else {
      console.warn('⚠️ config.yaml not found, using defaults');
      this.config = this.getDefaults();
    }

    // Override with environment variables
    this.applyEnvOverrides();

    // Validate required fields
    this.validate();
  }

  /**
   * Get default configuration
   */
  getDefaults() {
    return {
      llm: {
        provider: 'nvidia',
        model: 'moonshotai/kimi-k2.5',
        api_url: 'https://integrate.api.nvidia.com/v1/chat/completions',
        max_tokens: 16384,
        temperature: 1.0,
        top_p: 1.0,
        stream: false
      },
      interfaces: {
        telegram: { enabled: true },
        cli: { enabled: true },
        web: { enabled: false }
      },
      browser: {
        enabled: true,
        mode: 'visible',
        headless: false,
        timeout: 30000,
        viewport: { width: 1280, height: 720 }
      },
      persistence: {
        enabled: true,
        storage: 'markdown',
        path: './data/sessions',
        max_sessions: 100
      },
      skills: {
        path: './skills',
        auto_load: true,
        default_skill: 'general',
        priority: { mode: 'ask' }
      },
      logging: {
        level: 'info'
      }
    };
  }

  /**
   * Apply environment variable overrides
   */
  applyEnvOverrides() {
    // Telegram token
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token_here') {
      this.config.interfaces = this.config.interfaces || {};
      this.config.interfaces.telegram = this.config.interfaces.telegram || {};
      this.config.interfaces.telegram.bot_token = process.env.TELEGRAM_BOT_TOKEN;
    }

    // NVIDIA API key
    if (process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY !== 'your_nvidia_api_key_here') {
      this.config.llm = this.config.llm || {};
      this.config.llm.api_key = process.env.NVIDIA_API_KEY;
    }

    // Browser mode
    if (process.env.BROWSER_MODE) {
      this.config.browser = this.config.browser || {};
      this.config.browser.mode = process.env.BROWSER_MODE;
      this.config.browser.headless = process.env.BROWSER_MODE === 'headless';
    }

    // Persistence
    if (process.env.PERSISTENCE_ENABLED !== undefined) {
      this.config.persistence = this.config.persistence || {};
      this.config.persistence.enabled = process.env.PERSISTENCE_ENABLED === 'true';
    }

    // Log level
    if (process.env.LOG_LEVEL) {
      this.config.logging = this.config.logging || {};
      this.config.logging.level = process.env.LOG_LEVEL;
    }
  }

  /**
   * Validate required configuration
   */
  validate() {
    const required = [];
    
    if (this.config.interfaces?.telegram?.enabled && !this.config.interfaces?.telegram?.bot_token) {
      required.push('TELEGRAM_BOT_TOKEN');
    }

    if (required.length > 0) {
      console.warn('⚠️ Missing required configuration:');
      required.forEach(key => console.warn(`  - ${key}`));
    }
  }

  /**
   * Get a configuration value
   */
  get(path, defaultValue = null) {
    const keys = path.split('.');
    let value = this.config;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }
    
    return value;
  }

  /**
   * Get LLM configuration
   */
  get llm() {
    return this.config.llm || {};
  }

  /**
   * Get interface configuration
   */
  get interfaces() {
    return this.config.interfaces || {};
  }

  /**
   * Get browser configuration
   */
  get browser() {
    return this.config.browser || {};
  }

  /**
   * Get persistence configuration
   */
  get persistence() {
    return this.config.persistence || {};
  }

  /**
   * Get skills configuration
   */
  get skills() {
    return this.config.skills || {};
  }

  /**
   * Get logging configuration
   */
  get logging() {
    return this.config.logging || {};
  }

  /**
   * Set a configuration value
   */
  set(path, value) {
    const keys = path.split('.');
    let obj = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in obj) || typeof obj[key] !== 'object') {
        obj[key] = {};
      }
      obj = obj[key];
    }
    
    obj[keys[keys.length - 1]] = value;
  }
}

export const config = new Config();
export default config;