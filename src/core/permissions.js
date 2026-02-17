import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PERMISSIONS_FILE = join(__dirname, '../../data/permissions.json');

const PERMISSION_TYPES = {
  folder_access: {
    description: 'Access to folders/directories',
    fields: ['path', 'level'],  // level: 'read' or 'read-write'
    defaultLevel: 'read'
  },
  package_install: {
    description: 'Install packages (npm, brew, pip, apt)',
    fields: ['package', 'method'],  // method: npm, brew, pip, apt
    defaultLevel: 'once'
  },
  command_run: {
    description: 'Execute shell commands',
    fields: ['command', 'cwd'],
    defaultLevel: 'once'
  },
  network_access: {
    description: 'Make network requests',
    fields: ['url', 'method'],
    defaultLevel: 'always'
  }
};

class PermissionManager {
  constructor() {
    this.permissions = new Map();
    this.pendingRequests = new Map();
    this.loadPermissions();
  }

  ensureStorageDir() {
    const dir = dirname(PERMISSIONS_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  loadPermissions() {
    this.ensureStorageDir();
    try {
      if (existsSync(PERMISSIONS_FILE)) {
        const data = JSON.parse(readFileSync(PERMISSIONS_FILE, 'utf8'));
        for (const [key, value] of Object.entries(data)) {
          this.permissions.set(key, value);
        }
      }
      logger.info(`🔐 Loaded ${this.permissions.size} permission rules`);
    } catch (error) {
      logger.error('Failed to load permissions:', error.message);
    }
  }

  savePermissions() {
    this.ensureStorageDir();
    const data = {};
    for (const [key, value] of this.permissions) {
      data[key] = value;
    }
    writeFileSync(PERMISSIONS_FILE, JSON.stringify(data, null, 2));
  }

  generatePermissionKey(type, details) {
    const base = `${type}:`;
    if (type === 'folder_access') {
      return `${base}${details.path}`;
    } else if (type === 'package_install') {
      return `${base}${details.method}:${details.package}`;
    } else if (type === 'command_run') {
      return `${base}${details.command}`;
    } else if (type === 'network_access') {
      return `${base}${details.url}`;
    }
    return `${base}${JSON.stringify(details)}`;
  }

  requestPermission(type, details, userId = 'cli') {
    if (!PERMISSION_TYPES[type]) {
      throw new Error(`Unknown permission type: ${type}`);
    }

    const key = this.generatePermissionKey(type, details);
    
    if (this.permissions.has(key)) {
      const perm = this.permissions.get(key);
      if (perm.level === 'always') {
        return { granted: true, type, details, fromCache: true };
      }
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const request = {
      id: requestId,
      type,
      details,
      userId,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    this.pendingRequests.set(requestId, request);

    logger.info(`🔐 Permission request: ${type} - ${JSON.stringify(details)}`);
    
    return {
      granted: false,
      type,
      details,
      requestId,
      message: this.formatPermissionRequest(type, details)
    };
  }

  formatPermissionRequest(type, details) {
    const typeInfo = PERMISSION_TYPES[type];
    switch (type) {
      case 'folder_access':
        return `📁 Folder Access Request\n\nThe agent wants to access folder:\n\`${details.path}\`\n\nPermission level: ${details.level || 'read'}`;
      case 'package_install':
        return `📦 Package Install Request\n\nThe agent wants to install package:\n\`${details.package}\`\n\nMethod: ${details.method}`;
      case 'command_run':
        return `🔧 Command Execution Request\n\nThe agent wants to run:\n\`${details.command}\`\n\nWorking directory: ${details.cwd || 'current'}`;
      case 'network_access':
        return `🌐 Network Request\n\nThe agent wants to make a ${details.method || 'GET'} request to:\n\`${details.url}\``;
      default:
        return `Permission request: ${type}\n${JSON.stringify(details)}`;
    }
  }

  grantPermission(requestId, options = {}) {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return { success: false, error: 'Request not found' };
    }

    const { permanent = false, level = 'once' } = options;

    const key = this.generatePermissionKey(request.type, request.details);
    const permission = {
      type: request.type,
      details: request.details,
      level: permanent ? 'always' : level,
      grantedAt: new Date().toISOString(),
      grantedBy: request.userId
    };

    this.permissions.set(key, permission);
    this.savePermissions();

    request.status = 'granted';
    this.pendingRequests.delete(requestId);

    logger.success(`🔐 Permission granted: ${request.type}`);
    return { success: true, permission };
  }

  denyPermission(requestId) {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      return { success: false, error: 'Request not found' };
    }

    request.status = 'denied';
    this.pendingRequests.delete(requestId);

    logger.info(`🔐 Permission denied: ${request.type}`);
    return { success: true };
  }

  checkPermission(type, details) {
    const key = this.generatePermissionKey(type, details);
    return this.permissions.get(key) || null;
  }

  hasPermission(type, details) {
    const perm = this.checkPermission(type, details);
    if (!perm) return false;
    return perm.level === 'always';
  }

  revokePermission(type, details) {
    const key = this.generatePermissionKey(type, details);
    if (this.permissions.has(key)) {
      this.permissions.delete(key);
      this.savePermissions();
      logger.info(`🔐 Permission revoked: ${type}`);
      return { success: true };
    }
    return { success: false, error: 'Permission not found' };
  }

  getPendingRequests(userId = null) {
    const requests = Array.from(this.pendingRequests.values());
    if (userId) {
      return requests.filter(r => r.userId === userId);
    }
    return requests;
  }

  listPermissions() {
    const list = [];
    for (const [key, value] of this.permissions) {
      list.push({
        key,
        ...value
      });
    }
    return list;
  }

  clearAllPermissions() {
    this.permissions.clear();
    this.savePermissions();
    logger.info('🔐 All permissions cleared');
  }
}

export const permissions = new PermissionManager();
export default permissions;
