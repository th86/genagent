import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Session Manager with Markdown History Persistence
 */
class SessionManager {
  constructor() {
    this.sessionsPath = join(__dirname, '../../data/sessions');
    this.currentSession = null;
    this.ensureDataDirectory();
  }

  /**
   * Ensure data directory exists
   */
  ensureDataDirectory() {
    if (!existsSync(this.sessionsPath)) {
      mkdirSync(this.sessionsPath, { recursive: true });
    }
  }

  /**
   * Create or get a session
   */
  getSession(sessionId) {
    if (!config.persistence.enabled) {
      return this.createTransientSession();
    }

    const filepath = this.getSessionFile(sessionId);
    
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, 'utf8');
        const session = this.parseSessionFile(content);
        this.currentSession = session;
        return session;
      } catch (error) {
        console.error('Failed to load session:', error.message);
      }
    }

    // Create new session
    const session = this.createNewSession(sessionId);
    this.saveSession(session);
    this.currentSession = session;
    return session;
  }

  /**
   * Create a new session
   */
  createNewSession(sessionId) {
    return {
      id: sessionId || this.generateSessionId(),
      created: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      messages: [],
      skills: [],
      metadata: {
        totalMessages: 0,
        skillsUsed: []
      }
    };
  }

  /**
   * Create transient session (no persistence)
   */
  createTransientSession() {
    return {
      id: 'transient',
      messages: [],
      addMessage: (role, content) => {
        this.currentSession?.messages.push({ role, content, timestamp: new Date().toISOString() });
      }
    };
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get session file path
   */
  getSessionFile(sessionId) {
    return join(this.sessionsPath, `${sessionId}.md`);
  }

  /**
   * Parse session file
   */
  parseSessionFile(content) {
    const lines = content.split('\n');
    const session = {
      id: '',
      created: '',
      lastActive: '',
      messages: [],
      skills: [],
      metadata: {}
    };

    let section = '';
    let inMessages = false;

    for (const line of lines) {
      if (line.startsWith('# Session:')) {
        session.id = line.replace('# Session:', '').trim();
      } else if (line.startsWith('Created:')) {
        session.created = line.replace('Created:', '').trim();
      } else if (line.startsWith('Last Active:')) {
        session.lastActive = line.replace('Last Active:', '').trim();
      } else if (line.startsWith('## Messages')) {
        inMessages = true;
      } else if (line.startsWith('### ')) {
        const parts = line.replace('### ', '').split(' (');
        if (parts.length >= 2) {
          section = {
            role: parts[0].toLowerCase(),
            timestamp: parts[1].replace(')', '').trim()
          };
        }
      } else if (inMessages && line.trim() && section) {
        session.messages.push({
          role: section.role,
          content: line.trim(),
          timestamp: section.timestamp
        });
      }
    }

    return session;
  }

  /**
   * Save session to markdown file
   */
  saveSession(session) {
    try {
      // Ensure directory exists
      this.ensureDataDirectory();
      
      if (!config.persistence?.enabled) return;

      const filepath = this.getSessionFile(session.id);
      const content = this.formatSessionAsMarkdown(session);
      writeFileSync(filepath, content, 'utf8');
    } catch (error) {
      console.error('Failed to save session:', error.message);
    }
  }

  /**
   * Format session as markdown
   */
  formatSessionAsMarkdown(session) {
    let md = `# Session: ${session.id}\n\n`;
    md += `Created: ${session.created}\n`;
    md += `Last Active: ${session.lastActive}\n\n`;
    
    md += `## Metadata\n\n`;
    md += `- Total Messages: ${session.messages?.length || 0}\n`;
    md += `- Skills Used: ${session.metadata?.skillsUsed?.join(', ') || 'None'}\n\n`;
    
    md += `## Messages\n\n`;
    
    if (session.messages && session.messages.length > 0) {
      for (const msg of session.messages) {
        const timestamp = msg.timestamp || new Date().toISOString();
        md += `### ${this.capitalize(msg.role)} (${timestamp})\n\n`;
        md += `${msg.content}\n\n`;
      }
    } else {
      md += `_No messages yet_\n\n`;
    }

    return md;
  }

  /**
   * Add message to session
   */
  addMessage(sessionId, role, content, skill = null) {
    const session = this.getSession(sessionId);
    
    if (!session.messages) session.messages = [];
    
    session.messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
      skill
    });

    session.lastActive = new Date().toISOString();
    
    if (skill && session.metadata) {
      if (!session.metadata.skillsUsed) session.metadata.skillsUsed = [];
      if (!session.metadata.skillsUsed.includes(skill)) {
        session.metadata.skillsUsed.push(skill);
      }
    }

    this.saveSession(session);
    return session;
  }

  /**
   * Get session history
   */
  getHistory(sessionId, limit = 50) {
    const session = this.getSession(sessionId);
    const messages = session.messages || [];
    return messages.slice(-limit);
  }

  /**
   * Get all sessions
   */
  getAllSessions() {
    try {
      const files = readdirSync(this.sessionsPath).filter(f => f.endsWith('.md'));
      return files.map(f => ({
        id: f.replace('.md', ''),
        filepath: join(this.sessionsPath, f)
      }));
    } catch (error) {
      logger.error('Failed to list sessions:', error);
      return [];
    }
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId) {
    const filepath = this.getSessionFile(sessionId);
    if (existsSync(filepath)) {
      unlinkSync(filepath);
      return true;
    }
    return false;
  }

  /**
   * Capitalize first letter
   */
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

export const sessionManager = new SessionManager();
export default sessionManager;