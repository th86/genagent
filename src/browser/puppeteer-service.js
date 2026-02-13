import puppeteer from 'puppeteer';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Browser Service - Puppeteer-based browser automation
 */
class BrowserService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.screenshotsPath = join(__dirname, '../../data/screenshots');
    this.ensureScreenshotsDirectory();
  }

  /**
   * Ensure screenshots directory exists
   */
  ensureScreenshotsDirectory() {
    if (!existsSync(this.screenshotsPath)) {
      mkdirSync(this.screenshotsPath, { recursive: true });
    }
  }

  /**
   * Initialize browser
   */
  async initialize() {
    if (this.browser) return;

    const browserConfig = config.browser;
    const isHeadless = browserConfig.mode === 'headless' || browserConfig.headless;

    logger.info(`🌐 Starting browser (${isHeadless ? 'headless' : 'visible mode'})...`);

    try {
      // Try to find system Chrome on Mac
      const possibleChromePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        process.env.HOME + '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      ];
      
      let executablePath = undefined;
      for (const path of possibleChromePaths) {
        const fs = await import('fs');
        if (fs.existsSync(path)) {
          executablePath = path;
          break;
        }
      }

      this.browser = await puppeteer.launch({
        headless: isHeadless ? 'new' : false,
        args: browserConfig.args || [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage'
        ],
        defaultViewport: {
          width: browserConfig.viewport?.width || 1280,
          height: browserConfig.viewport?.height || 720
        },
        ignoreDefaultArgs: ['--enable-automation'],
        executablePath: executablePath
      });

      this.page = await this.browser.newPage();
      
      // Set user agent if configured
      if (browserConfig.user_agent) {
        await this.page.setUserAgent(browserConfig.user_agent);
      }

      logger.success('Browser initialized');
    } catch (error) {
      logger.error('Failed to initialize browser:', error);
      throw error;
    }
  }

  /**
   * Open a URL
   */
  async open(url) {
    if (!this.browser) {
      await this.initialize();
    }

    try {
      logger.info(`Opening: ${url}`);
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: config.browser.timeout || 30000
      });

      const title = await this.page.title();
      logger.success(`Opened: ${title}`);

      return {
        success: true,
        title,
        url: this.page.url()
      };
    } catch (error) {
      logger.error('Failed to open URL:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get page title
   */
  async getTitle() {
    if (!this.page) return null;
    return await this.page.title();
  }

  /**
   * Get current URL
   */
  async getUrl() {
    if (!this.page) return null;
    return this.page.url();
  }

  /**
   * Take a screenshot
   */
  async screenshot(filename = null) {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    const name = filename || `screenshot_${Date.now()}.png`;
    const filepath = join(this.screenshotsPath, name);

    try {
      await this.page.screenshot({ path: filepath, fullPage: true });
      logger.success(`Screenshot saved: ${name}`);
      
      return {
        success: true,
        filepath,
        filename: name,
        url: `file://${filepath}`
      };
    } catch (error) {
      logger.error('Screenshot failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get page content/text
   */
  async getContent() {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      const content = await this.page.content();
      const text = await this.page.evaluate(() => document.body.innerText);
      
      return {
        success: true,
        html: content,
        text: text.substring(0, 5000)  // Limit text length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Click an element
   */
  async click(selector) {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.click(selector);
      
      logger.success(`Clicked: ${selector}`);
      
      return {
        success: true,
        selector
      };
    } catch (error) {
      logger.error(`Click failed for ${selector}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Type text into an element
   */
  async type(selector, text) {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      await this.page.waitForSelector(selector, { timeout: 5000 });
      await this.page.type(selector, text);
      
      logger.success(`Typed into: ${selector}`);
      
      return {
        success: true,
        selector,
        text
      };
    } catch (error) {
      logger.error(`Type failed for ${selector}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Scroll the page
   */
  async scroll(direction = 'down', amount = 500) {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      const scrollAmount = direction === 'up' ? -amount : amount;
      await this.page.evaluate((scroll) => {
        window.scrollBy(0, scroll);
      }, scrollAmount);

      logger.success(`Scrolled ${direction}`);
      
      return {
        success: true,
        direction,
        amount: scrollAmount
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Navigate back/forward/refresh
   */
  async navigate(action) {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      switch (action) {
        case 'back':
          await this.page.goBack();
          break;
        case 'forward':
          await this.page.goForward();
          break;
        case 'refresh':
          await this.page.reload();
          break;
        default:
          throw new Error(`Unknown navigation action: ${action}`);
      }

      logger.success(`Navigated: ${action}`);
      
      return {
        success: true,
        action,
        url: this.page.url()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Find elements by text
   */
  async findByText(text, type = 'click') {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      // Use JavaScript to find element containing text
      const result = await this.page.evaluate((searchText) => {
        const elements = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"]'));
        const found = elements.find(el => 
          el.innerText.toLowerCase().includes(searchText.toLowerCase()) ||
          el.textContent.toLowerCase().includes(searchText.toLowerCase())
        );
        
        if (found) {
          return {
            tag: found.tagName,
            text: found.innerText.substring(0, 100),
            selector: found.id ? `#${found.id}` : found.className ? `.${found.className.split(' ')[0]}` : null
          };
        }
        return null;
      }, text);

      if (result) {
        logger.success(`Found element: ${result.text}`);
        return {
          success: true,
          ...result
        };
      } else {
        return {
          success: false,
          error: `No element found containing: ${text}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Wait for navigation
   */
  async waitForNavigation(timeout = 30000) {
    if (!this.page) {
      return { success: false, error: 'Browser not initialized' };
    }

    try {
      await this.page.waitForNavigation({ timeout });
      return {
        success: true,
        url: this.page.url()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get page metrics
   */
  async getMetrics() {
    if (!this.page) {
      return null;
    }

    try {
      const metrics = await this.page.metrics();
      return {
        documents: metrics.Nodes,
        frames: metrics.Frames,
        jsHeapSize: metrics.JSHeapUsedSize,
        layoutCount: metrics.LayoutCount,
        styleRecalcCount: metrics.LayoutCount
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Set browser mode (visible/headless)
   */
  async setMode(mode) {
    const isHeadless = mode === 'headless';
    
    if (this.browser) {
      await this.close();
    }

    config.set('browser.mode', mode);
    config.set('browser.headless', isHeadless);
    
    await this.initialize();
    
    return { success: true, mode };
  }

  /**
   * Close browser
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.info('Browser closed');
    }
  }

  /**
   * Check if browser is initialized
   */
  isReady() {
    return this.browser !== null && this.page !== null;
  }
}

export const browserService = new BrowserService();
export default browserService;