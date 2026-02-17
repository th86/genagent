import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger.js';
import permissions from './permissions.js';
import skillManager from './skill-manager.js';

const execAsync = promisify(exec);

const ERROR_PATTERNS = {
  missing_npm_package: {
    patterns: [
      /Cannot find module ['"]([^'"]+)['"]/,
      /Module not found:\s*['"]([^'"]+)['"]/,
      /ENOENT:\s*no such file or directory.*['"]([^'"]+)['"]/,
      /require\(['"]([^'"]+)['"]\)/
    ],
    fixType: 'package_install',
    method: 'npm'
  },
  missing_global_package: {
    patterns: [
      /command not found:\s*(\S+)/,
      /['"]([^'"]+)['"]\s*is not recognized as an internal or external command/,
      /bash:\s*(\S+):\s*command not found/
    ],
    fixType: 'package_install',
    method: 'system'
  },
  missing_brew_package: {
    patterns: [
      /brew:\s*command not found/,
      /No formula.*with name.*(\S+)/
    ],
    fixType: 'package_install',
    method: 'brew'
  },
  missing_pip_package: {
    patterns: [
      /ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/,
      /ImportError:\s*No module named ['"]([^'"]+)['"]/
    ],
    fixType: 'package_install',
    method: 'pip'
  },
  permission_denied: {
    patterns: [
      /EACCES:\s*permission denied/,
      /permission denied.*(\S+)/
    ],
    fixType: 'command_run',
    method: 'sudo'
  },
  missing_folder: {
    patterns: [
      /ENOENT:\s*no such file or directory.*['"]([^'"]+)['"]/,
      /No such file or directory.*['"]([^'"]+)['"]/
    ],
    fixType: 'folder_access',
    method: 'create'
  }
};

class AutoFix {
  constructor() {
    this.maxAttempts = 5;
    this.currentAttempts = new Map();
    this.stopFlags = new Set();
  }

  analyzeError(error) {
    const errorStr = String(error).toLowerCase();
    
    for (const [fixType, config] of Object.entries(ERROR_PATTERNS)) {
      for (const pattern of config.patterns) {
        const match = String(error).match(pattern);
        if (match) {
          const target = match[1] || match[0];
          return {
            fixable: true,
            fixType: config.fixType,
            method: config.method,
            target,
            originalError: String(error)
          };
        }
      }
    }
    
    return {
      fixable: false,
      originalError: String(error)
    };
  }

  suggestFix(analysis) {
    const { fixType, method, target } = analysis;
    
    switch (fixType) {
      case 'package_install':
        return {
          action: 'install_package',
          details: {
            type: 'package_install',
            package: target,
            method: method === 'system' ? 'npm' : method,
            command: this.getInstallCommand(method, target)
          },
          message: `I can try to install the missing package "\x1b[33m${target}\x1b[0m" using ${method}. May I proceed?`
        };
      
      case 'command_run':
        return {
          action: 'run_command',
          details: {
            type: 'command_run',
            command: target,
            suggestedCommand: `sudo npm install -g ${target}`
          },
          message: `I can try to run the command with elevated permissions. May I proceed?`
        };
      
      case 'folder_access':
        return {
          action: 'create_folder',
          details: {
            type: 'folder_access',
            path: target,
            level: 'read-write'
          },
          message: `I can try to create the missing folder "\x1b[33m${target}\x1b[0m". May I proceed?`
        };
      
      default:
        return null;
    }
  }

  getInstallCommand(method, packageName) {
    switch (method) {
      case 'npm':
        return `npm install ${packageName}`;
      case 'yarn':
        return `yarn add ${packageName}`;
      case 'pnpm':
        return `pnpm add ${packageName}`;
      case 'pip':
        return `pip install ${packageName}`;
      case 'pip3':
        return `pip3 install ${packageName}`;
      case 'brew':
        return `brew install ${packageName}`;
      case 'apt':
        return `sudo apt-get install ${packageName}`;
      default:
        return `npm install ${packageName}`;
    }
  }

  async requestPermission(details) {
    const permRequest = permissions.requestPermission(details.type, details);
    return permRequest;
  }

  async executeFix(fixDetails) {
    const { type, command, path, method, package: pkg } = fixDetails;

    try {
      switch (type) {
        case 'package_install': {
          const installCmd = this.getInstallCommand(method, pkg);
          logger.info(`🔧 Installing package: ${pkg} using ${method}`);
          
          if (method === 'npm' || method === 'yarn' || method === 'pnpm') {
            return await this.runCommand(installCmd);
          } else if (method === 'pip' || method === 'pip3') {
            return await this.runCommand(`${method} install ${pkg}`);
          } else if (method === 'brew') {
            return await this.runCommand(`brew install ${pkg}`);
          } else if (method === 'apt') {
            return await this.runCommand(`sudo apt-get update && sudo apt-get install -y ${pkg}`);
          }
          break;
        }
        
        case 'command_run': {
          logger.info(`🔧 Running command: ${command}`);
          return await this.runCommand(command);
        }
        
        case 'folder_access': {
          const fs = await import('fs');
          const { mkdir } = await import('fs/promises');
          
          if (!fs.existsSync(path)) {
            await mkdir(path, { recursive: true });
            logger.success(`🔧 Created folder: ${path}`);
            return { success: true, message: `Created folder: ${path}` };
          }
          return { success: true, message: `Folder already exists: ${path}` };
        }
      }
    } catch (error) {
      logger.error(`🔧 Fix failed: ${error.message}`);
      return { success: false, error: error.message };
    }
    
    return { success: false, error: 'Unknown fix type' };
  }

  runCommand(command) {
    return new Promise((resolve, reject) => {
      const isSudo = command.startsWith('sudo');
      const cmd = isSudo ? command.slice(5) : command;
      
      const parts = cmd.split(' ');
      const bin = parts[0];
      const args = parts.slice(1);
      
      const proc = spawn(bin, args, {
        shell: true,
        stdio: 'pipe'
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
          resolve({ success: true, stdout, stderr });
        } else {
          reject(new Error(stderr || stdout || `Command exited with code ${code}`));
        }
      });
      
      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  async attemptFix(taskId, fixSuggestion, onPermissionRequest) {
    const attempts = this.currentAttempts.get(taskId) || 0;
    
    if (attempts >= this.maxAttempts) {
      return {
        success: false,
        error: `Maximum ${this.maxAttempts} attempts reached`,
        attempts
      };
    }
    
    if (this.stopFlags.has(taskId)) {
      this.stopFlags.delete(taskId);
      return {
        success: false,
        error: 'Task stopped by user',
        stopped: true,
        attempts
      };
    }
    
    this.currentAttempts.set(taskId, attempts + 1);
    
    logger.info(`🔧 Attempt ${attempts + 1}/${this.maxAttempts} for task ${taskId}`);
    
    try {
      const result = await this.executeFix(fixSuggestion.details);
      
      if (result.success) {
        this.currentAttempts.delete(taskId);
        return {
          success: true,
          message: result.message || 'Fix applied successfully',
          attempts: attempts + 1
        };
      } else {
        return {
          success: false,
          error: result.error,
          attempts: attempts + 1,
          canRetry: attempts + 1 < this.maxAttempts
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        attempts: attempts + 1,
        canRetry: attempts + 1 < this.maxAttempts
      };
    }
  }

  getAttempts(taskId) {
    return this.currentAttempts.get(taskId) || 0;
  }

  resetAttempts(taskId) {
    this.currentAttempts.delete(taskId);
  }

  stop(taskId) {
    this.stopFlags.add(taskId);
    logger.info(`🔧 Stop requested for task ${taskId}`);
  }

  isStopped(taskId) {
    return this.stopFlags.has(taskId);
  }

  clearStop(taskId) {
    this.stopFlags.delete(taskId);
  }
}

export const autofix = new AutoFix();
export default autofix;
