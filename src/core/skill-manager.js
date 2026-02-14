import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Skill Manager - Loads and manages skills from skill.md files
 */
class SkillManager {
  constructor() {
    this.skills = new Map();
    this.skillsPath = join(__dirname, '../../skills');
  }

  /**
   * Load all skills from the skills directory
   */
  async loadSkills() {
    logger.info('📂 Loading skills from ' + this.skillsPath);
    
    try {
      if (!existsSync(this.skillsPath)) {
        logger.warn('⚠️ Skills directory does not exist, creating...');
        await import('fs').then(fs => {
          if (!fs.existsSync(this.skillsPath)) {
            fs.mkdirSync(this.skillsPath, { recursive: true });
          }
        });
      }

      const files = readdirSync(this.skillsPath).filter(f => f.endsWith('.md'));
      
      for (const file of files) {
        await this.loadSkill(file);
      }

      // Load built-in skills
      await this.loadBuiltInSkills();

      logger.success(`✨ Loaded ${this.skills.size} skills`);
    } catch (error) {
      logger.error('Failed to load skills:', error);
    }
  }

  /**
   * Load a single skill from a .md file
   */
  async loadSkill(filename) {
    try {
      const filepath = join(this.skillsPath, filename);
      const content = readFileSync(filepath, 'utf8');
      
      // Parse skill from markdown
      const skill = this.parseSkillFile(content, filename);
      
      if (skill) {
        this.skills.set(skill.name.toLowerCase(), skill);
        logger.debug(`📦 Loaded skill: ${skill.name}`);
      }
    } catch (error) {
      logger.error(`Failed to load skill ${filename}:`, error);
    }
  }

  /**
   * Parse a skill.md file
   */
  parseSkillFile(content, filename) {
    // Split frontmatter and body - handle both --- at start/end
    const parts = content.split(/^---$/m);
    
    let metadata = {};
    let body = content;
    
    if (parts.length >= 2) {
      // Has frontmatter (--- at start)
      try {
        // Find the YAML between the first pair of ---
        const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (yamlMatch) {
          metadata = parseYaml(yamlMatch[1]) || {};
          // Get body after the second ---
          body = content.replace(/^---[\s\S]*?---\n/, '');
        }
      } catch (e) {
        logger.warn(`Failed to parse frontmatter in ${filename}:`, e.message);
      }
    }

    // Extract sections from body
    const lines = body.split('\n');
    let currentSection = '';
    let sections = {};
    let sectionContent = [];

    for (const line of lines) {
      const match = line.match(/^##\s+(.+)$/);
      if (match) {
        if (currentSection) {
          sections[currentSection] = sectionContent.join('\n').trim();
        }
        currentSection = match[1].toLowerCase();
        sectionContent = [];
      } else if (currentSection) {
        sectionContent.push(line);
      }
    }
    
    if (currentSection) {
      sections[currentSection] = sectionContent.join('\n').trim();
    }

    // Build skill object
    const skill = {
      name: metadata.name || this.filenameToName(filename),
      description: metadata.description || sections.description || '',
      version: metadata.version || '1.0.0',
      priority: metadata.priority || 10,
      triggers: metadata.triggers || this.extractTriggers(sections.capabilities || ''),
      capabilities: this.parseCapabilities(sections.capabilities || ''),
      systemPrompt: metadata.system_prompt || sections.system_prompt || sections.systemprompt || this.buildDefaultPrompt(metadata.name),
      apiEndpoints: metadata.api_endpoints || {},
      config: metadata.config || {},
      enabled: metadata.enabled !== false,
      filename: filename
    };

    return skill;
  }

  /**
   * Convert filename to skill name
   */
  filenameToName(filename) {
    return basename(filename, '.md')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Extract triggers from capabilities text
   */
  extractTriggers(capabilitiesText) {
    const triggers = [];
    const lines = capabilitiesText.split('\n');
    
    for (const line of lines) {
      const match = line.match(/-\s+(.+?)(?::|$)/);
      if (match) {
        triggers.push(match[1].trim().toLowerCase());
      }
    }
    
    return triggers;
  }

  /**
   * Parse capabilities section
   */
  parseCapabilities(capabilitiesText) {
    const capabilities = [];
    const lines = capabilitiesText.split('\n');
    let currentCap = null;

    for (const line of lines) {
      const nameMatch = line.match(/^-\s+name:\s*(.+)$/);
      const descMatch = line.match(/^\s+description:\s*(.+)$/);
      const methodMatch = line.match(/^\s+method:\s*(.+)$/);

      if (nameMatch) {
        if (currentCap) capabilities.push(currentCap);
        currentCap = { name: nameMatch[1].trim() };
      } else if (currentCap) {
        if (descMatch) currentCap.description = descMatch[1].trim();
        if (methodMatch) currentCap.method = methodMatch[1].trim();
      }
    }

    if (currentCap) capabilities.push(currentCap);
    return capabilities;
  }

  /**
   * Build default system prompt
   */
  buildDefaultPrompt(skillName) {
    return `You are a helpful AI assistant with expertise in ${skillName}.`;
  }

  /**
   * Load built-in skills
   */
  async loadBuiltInSkills() {
    // General skill (always available)
    this.skills.set('general', {
      name: 'General',
      description: 'General-purpose AI assistant',
      priority: 0,
      triggers: [],
      capabilities: [
        { name: 'general', description: 'General conversation', method: 'chat' }
      ],
      systemPrompt: `You are a helpful, friendly AI assistant. Provide accurate and thoughtful responses to user queries.`,
      enabled: true
    });
  }

  /**
   * Detect which skills match a query
   */
  detectSkills(query) {
    const matches = [];
    const queryLower = query.toLowerCase();

    for (const [name, skill] of this.skills) {
      if (!skill.enabled) continue;

      let score = 0;
      const matchedTriggers = [];

      // Check triggers
      for (const trigger of skill.triggers) {
        if (queryLower.includes(trigger.toLowerCase())) {
          score += 10;
          matchedTriggers.push(trigger);
        }
      }

      // Check capability names
      for (const cap of skill.capabilities) {
        if (cap.name && queryLower.includes(cap.name.toLowerCase())) {
          score += 5;
        }
      }

      if (score > 0) {
        matches.push({
          skill: name,
          skillData: skill,
          confidence: score,
          triggers: matchedTriggers
        });
      }
    }

    // Sort by confidence
    matches.sort((a, b) => b.confidence - a.confidence);

    return matches;
  }

  /**
   * Get skill by name
   */
  getSkill(name) {
    return this.skills.get(name.toLowerCase());
  }

  /**
   * Get all skills
   */
  getAllSkills() {
    return Array.from(this.skills.values());
  }

  /**
   * Get enabled skills
   */
  getEnabledSkills() {
    return this.getAllSkills().filter(s => s.enabled);
  }

  /**
   * Reload a specific skill
   */
  async reloadSkill(filename) {
    await this.loadSkill(filename);
  }

  /**
   * Reload all skills
   */
  async reloadAll() {
    this.skills.clear();
    await this.loadSkills();
  }
}

export const skillManager = new SkillManager();
export default skillManager;