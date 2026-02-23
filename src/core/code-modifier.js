import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync, rmSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BACKUP_DIR = join(__dirname, '../../data/backups');
const MAX_BACKUPS = 10;

class CodeModifier {
  constructor() {
    this.currentBackup = null;
    this.pendingChanges = null;
    this.ensureBackupDir();
  }

  ensureBackupDir() {
    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  getBackupPath(name = 'current') {
    return join(BACKUP_DIR, name);
  }

  createBackup(name = 'current') {
    const srcDir = join(__dirname, '../..');
    const backupPath = this.getBackupPath(name);
    
    if (existsSync(backupPath)) {
      rmSync(backupPath, { recursive: true, force: true });
    }

    mkdirSync(backupPath, { recursive: true });
    
    const dirsToBackup = ['src', 'skills', 'config.yaml'];
    const filesToBackup = ['package.json', 'README.md'];
    
    for (const dir of dirsToBackup) {
      const srcPath = join(srcDir, dir);
      if (existsSync(srcPath)) {
        const destPath = join(backupPath, dir);
        cpSync(srcPath, destPath, { recursive: true });
      }
    }
    
    for (const file of filesToBackup) {
      const srcPath = join(srcDir, file);
      if (existsSync(srcPath)) {
        const destPath = join(backupPath, file);
        cpSync(srcPath, destPath);
      }
    }

    this.currentBackup = backupPath;
    logger.info(`💾 Created backup at: ${backupPath}`);
    
    this.cleanOldBackups();
    
    return backupPath;
  }

  cleanOldBackups() {
    try {
      const entries = readdirSync(BACKUP_DIR, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory())
        .map(e => ({ name: e.name, path: join(BACKUP_DIR, e.name) }))
        .filter(d => d.name.startsWith('backup_'))
        .sort((a, b) => b.name.localeCompare(a.name));
      
      if (dirs.length > MAX_BACKUPS) {
        for (let i = MAX_BACKUPS; i < dirs.length; i++) {
          rmSync(dirs[i].path, { recursive: true, force: true });
          logger.info(`🗑️ Cleaned old backup: ${dirs[i].name}`);
        }
      }
    } catch (error) {
      logger.warn('Failed to clean old backups:', error.message);
    }
  }

  restoreBackup(name = 'current') {
    const backupPath = this.getBackupPath(name);
    const srcDir = join(__dirname, '../..');
    
    if (!existsSync(backupPath)) {
      throw new Error(`Backup not found: ${name}`);
    }

    const dirsToRestore = ['src', 'skills'];
    const filesToRestore = ['config.yaml'];
    
    for (const dir of dirsToRestore) {
      const backupSubDir = join(backupPath, dir);
      if (existsSync(backupSubDir)) {
        const destPath = join(srcDir, dir);
        if (existsSync(destPath)) {
          rmSync(destPath, { recursive: true, force: true });
        }
        cpSync(backupSubDir, destPath, { recursive: true });
      }
    }
    
    for (const file of filesToRestore) {
      const backupFile = join(backupPath, file);
      if (existsSync(backupFile)) {
        const destFile = join(srcDir, file);
        cpSync(backupFile, destFile);
      }
    }

    logger.success(`♻️ Restored backup from: ${name}`);
    return true;
  }

  validateChange(change) {
    if (!change.file) {
      return { valid: false, error: 'Missing file path' };
    }

    if (!change.operation) {
      return { valid: false, error: 'Missing operation (create/update/delete)' };
    }

    const allowedDirs = ['src', 'skills'];
    const isAllowed = allowedDirs.some(dir => change.file.startsWith(dir));
    
    if (!isAllowed) {
      return { valid: false, error: `Can only modify files in: ${allowedDirs.join(', ')}` };
    }

    if (change.operation === 'create' && !change.content) {
      return { valid: false, error: 'Missing content for create operation' };
    }

    return { valid: true };
  }

  applyChange(change) {
    const validation = this.validateChange(change);
    if (!validation.valid) {
      throw new Error(`Invalid change: ${validation.error}`);
    }

    const baseDir = join(__dirname, '../..');
    const filePath = join(baseDir, change.file);
    const dirPath = dirname(filePath);

    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    switch (change.operation) {
      case 'create':
        writeFileSync(filePath, change.content);
        logger.info(`📄 Created file: ${change.file}`);
        break;

      case 'update':
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${change.file}`);
        }
        const existingContent = readFileSync(filePath, 'utf8');
        
        if (change.find && change.replace) {
          if (!existingContent.includes(change.find)) {
            throw new Error(`Could not find "${change.find}" in ${change.file}`);
          }
          const newContent = existingContent.replace(change.find, change.replace);
          writeFileSync(filePath, newContent);
        } else if (change.content) {
          writeFileSync(filePath, change.content);
        }
        logger.info(`📝 Updated file: ${change.file}`);
        break;

      case 'delete':
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true });
          logger.info(`🗑️ Deleted file: ${change.file}`);
        }
        break;

      default:
        throw new Error(`Unknown operation: ${change.operation}`);
    }

    return { success: true, file: change.file };
  }

  async applyChanges(changes, description = '') {
    if (!Array.isArray(changes)) {
      changes = [changes];
    }

    for (const change of changes) {
      const validation = this.validateChange(change);
      if (!validation.valid) {
        throw new Error(`Invalid change: ${validation.error}`);
      }
    }

    logger.info(`🔧 Applying ${changes.length} code change(s): ${description}`);
    
    const backupName = `backup_${Date.now()}`;
    this.createBackup(backupName);

    const appliedChanges = [];
    
    try {
      for (const change of changes) {
        const result = this.applyChange(change);
        appliedChanges.push(result);
      }

      this.pendingChanges = {
        name: backupName,
        description,
        changes: appliedChanges,
        timestamp: new Date().toISOString()
      };

      return {
        success: true,
        backup: backupName,
        changes: appliedChanges
      };
    } catch (error) {
      logger.error(`Failed to apply changes: ${error.message}`);
      logger.info(`♻️ Attempting to restore backup...`);
      
      try {
        this.restoreBackup(backupName);
        return {
          success: false,
          error: error.message,
          restored: true
        };
      } catch (restoreError) {
        return {
          success: false,
          error: error.message,
          restoreError: restoreError.message
        };
      }
    }
  }

  async verifyStartup() {
    const srcDir = join(__dirname, '../..');
    
    try {
      const mainFile = join(srcDir, 'src/index.js');
      if (!existsSync(mainFile)) {
        return { valid: false, error: 'Main entry point not found' };
      }

      const content = readFileSync(mainFile, 'utf8');
      if (!content.includes('GenAgent') || !content.includes('import')) {
        return { valid: false, error: 'Main file appears corrupted' };
      }

      const agentFile = join(srcDir, 'src/core/agent.js');
      if (existsSync(agentFile)) {
        const agentContent = readFileSync(agentFile, 'utf8');
        if (!agentContent.includes('class Agent')) {
          return { valid: false, error: 'Agent file appears corrupted' };
        }
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  revertPending() {
    if (this.pendingChanges) {
      logger.info(`♻️ Reverting pending changes from backup: ${this.pendingChanges.name}`);
      this.restoreBackup(this.pendingChanges.name);
      this.pendingChanges = null;
      return true;
    }
    return false;
  }

  getPendingChanges() {
    return this.pendingChanges;
  }

  listBackups() {
    try {
      const entries = readdirSync(BACKUP_DIR, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort((a, b) => b.localeCompare(a.name));
    } catch (error) {
      return [];
    }
  }
}

export const codeModifier = new CodeModifier();
export default codeModifier;
