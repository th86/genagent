import { spawn, execSync, exec } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import logger from '../utils/logger.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Agent Browser Service - Fallback browser automation using agent-browser
 * https://agent-browser.dev/
 */
class AgentBrowserService {
  constructor() {
    this.screenshotsPath = join(__dirname, '../../../data/screenshots');
    this.currentUrl = null;
    this.ensureScreenshotsDirectory();
  }

  ensureScreenshotsDirectory() {
    if (!existsSync(this.screenshotsPath)) {
      mkdirSync(this.screenshotsPath, { recursive: true });
    }
  }

  /**
   * Run agent-browser command
   */
  async runCommand(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn('npx', ['agent-browser', ...args], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout, stderr });
        } else {
          resolve({ success: false, output: stdout, error: stderr || `Exit code: ${code}` });
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Open a URL
   */
  async open(url) {
    try {
      logger.info(`Opening with agent-browser: ${url}`);
      
      // Close any existing session first
      await this.runCommand(['close']).catch(() => {});
      
      // Start new session and open URL
      const result = await this.runCommand(['open', url]);
      
      if (result.success) {
        this.currentUrl = url;
        logger.success(`Opened: ${url}`);
        return {
          success: true,
          title: url,
          url: url,
          output: result.output
        };
      } else {
        logger.error(`Failed to open: ${result.error}`);
        return {
          success: false,
          error: result.error
        };
      }
    } catch (error) {
      logger.error('agent-browser error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get snapshot (accessibility tree)
   */
  async getSnapshot() {
    try {
      const result = await this.runCommand(['snapshot', '-i']);
      
      if (result.success) {
        return {
          success: true,
          output: result.output,
          url: this.currentUrl
        };
      } else {
        return {
          success: false,
          error: result.error
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
   * Get content (text from page)
   */
  async getContent() {
    const snapshot = await this.getSnapshot();
    
    if (snapshot.success) {
      // Parse the compact snapshot format
      const lines = snapshot.output.split('\n').filter(l => l.trim());
      
      return {
        success: true,
        text: snapshot.output,
        url: this.currentUrl,
        elements: lines.length,
        snapshot: snapshot.output
      };
    }
    
    return {
      success: false,
      error: snapshot.error
    };
  }

  /**
   * Click an element by ref
   */
  async click(ref) {
    try {
      // Ensure ref format is correct
      const targetRef = ref.startsWith('@') ? ref : `@${ref}`;
      const result = await this.runCommand(['click', targetRef]);
      
      if (result.success) {
        logger.success(`Clicked: ${targetRef}`);
        return {
          success: true,
          selector: targetRef,
          output: result.output
        };
      } else {
        return {
          success: false,
          error: result.error
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
   * Type text
   */
  async type(text, ref = null) {
    try {
      if (ref) {
        const targetRef = ref.startsWith('@') ? ref : `@${ref}`;
        const result = await this.runCommand(['type', targetRef, text]);
        
        if (result.success) {
          return { success: true, text, selector: targetRef };
        } else {
          return { success: false, error: result.error };
        }
      } else {
        // Type at focused element
        const result = await this.runCommand(['type', '--', text]);
        return result.success 
          ? { success: true, text }
          : { success: false, error: result.error };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Take screenshot
   */
  async screenshot(filename = null) {
    const name = filename || `screenshot_${Date.now()}.png`;
    const filepath = join(this.screenshotsPath, name);

    try {
      const result = await this.runCommand(['screenshot', filepath]);
      
      if (result.success) {
        logger.success(`Screenshot saved: ${name}`);
        return {
          success: true,
          filepath,
          filename: name,
          url: `file://${filepath}`
        };
      } else {
        return {
          success: false,
          error: result.error
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
   * Scroll
   */
  async scroll(direction = 'down', amount = 500) {
    try {
      const result = await this.runCommand(['scroll', direction]);
      return result.success
        ? { success: true, direction, amount }
        : { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Navigate
   */
  async navigate(action) {
    try {
      let result;
      switch (action) {
        case 'back':
          result = await this.runCommand(['back']);
          break;
        case 'forward':
          result = await this.runCommand(['forward']);
          break;
        case 'refresh':
          result = await this.runCommand(['refresh']);
          break;
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }

      return result.success
        ? { success: true, action, url: this.currentUrl }
        : { success: false, error: result.error };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Find element by text
   */
  async findByText(text) {
    try {
      // Get snapshot and search for text
      const snapshot = await this.getSnapshot();
      
      if (snapshot.success) {
        const lines = snapshot.output.split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes(text.toLowerCase())) {
            // Extract ref from line like: link "text" [ref=@e1]
            const match = line.match(/\[ref=(@\w+)\]/);
            if (match) {
              return {
                success: true,
                ref: match[1],
                text: line.trim()
              };
            }
          }
        }
        return {
          success: false,
          error: `No element found containing: ${text}`
        };
      }
      
      return { success: false, error: snapshot.error };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Close browser
   */
  async close() {
    try {
      await this.runCommand(['close']);
      this.currentUrl = null;
      logger.info('agent-browser closed');
    } catch (error) {
      // Ignore close errors
    }
  }

  /**
   * Check if agent-browser is available
   */
  async isAvailable() {
    try {
      const result = await this.runCommand(['--version']);
      return result.success;
    } catch {
      return false;
    }
  }
}

export const agentBrowserService = new AgentBrowserService();
export default agentBrowserService;
