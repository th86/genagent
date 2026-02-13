import nvidiaClient from '../llm/nvidia-client.js';
import skillManager from './skill-manager.js';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Main Agent Orchestrator for GenAgent
 */
class Agent {
  constructor() {
    this.currentSkill = null;
    this.sessionHistory = [];
    this.initialized = false;
  }

  /**
   * Initialize the agent
   */
  async initialize() {
    logger.startup('GenAgent');

    // Test LLM connection
    logger.info('🔗 Testing NVIDIA NIM connection...');
    const llmConnected = await nvidiaClient.testConnection();
    
    if (!llmConnected) {
      logger.warn('⚠️ NVIDIA NIM connection failed - using fallback mode');
    } else {
      logger.success('NVIDIA NIM connected');
    }

    // Load skills
    await skillManager.loadSkills();

    this.initialized = true;
    logger.ready('GenAgent');
  }

  /**
   * Process a user message
   */
  async processMessage(message, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const { skillName, context = [], stream = false } = options;

    // Detect or use specified skill
    let skill = null;
    let detectedSkills = [];

    if (skillName) {
      skill = skillManager.getSkill(skillName);
      if (!skill) {
        return { error: `Skill '${skillName}' not found` };
      }
    } else {
      detectedSkills = skillManager.detectSkills(message);
      
      if (detectedSkills.length === 0) {
        // Use general skill
        skill = skillManager.getSkill('general');
      } else if (detectedSkills.length === 1) {
        // Single skill match
        skill = detectedSkills[0].skillData;
      } else {
        // Multiple matches - return for user selection
        return {
          needsChoice: true,
          skills: detectedSkills.map(s => ({
            name: s.skillData.name,
            description: s.skillData.description,
            confidence: s.confidence,
            triggers: s.triggers
          }))
        };
      }
    }

    // Build prompt with skill context
    const prompt = this.buildPrompt(message, skill, context);

    // Get response from LLM
    try {
      if (stream) {
        return this.streamResponse(prompt, context);
      } else {
        const response = await nvidiaClient.getCompleteResponse(prompt, context);
        
        // Add to history
        this.sessionHistory.push({ role: 'user', content: message });
        this.sessionHistory.push({ role: 'assistant', content: response });

        return {
          response,
          skill: skill.name,
          detectedSkills: detectedSkills
        };
      }
    } catch (error) {
      logger.error('Error processing message:', error.message);
      
      // Provide helpful error message based on error type
      let errorMessage = error.message;
      let fallbackResponse = null;
      
      if (error.message.includes('404') || error.message.includes('not found')) {
        errorMessage = 'NVIDIA API: Model not found. Please check config.yaml for valid model name.';
        fallbackResponse = `⚠️ NVIDIA API Error: The specified model may not be available.

Current model: ${config.llm.model}

Please visit https://build.nvidia.com/ to see available models and update config.yaml.

For now, I'm operating in limited mode. You can still:
• Use browser commands: open <url>, screenshot
• List skills: skills
• Get help: help

The AI chat will work once the model is configured correctly.`;
      } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        errorMessage = 'NVIDIA API: Invalid or missing API key. Please check your NVIDIA_API_KEY in .env';
        fallbackResponse = `⚠️ NVIDIA API Error: Authentication failed.

Please check your NVIDIA_API_KEY in the .env file.

You can still use browser commands:
• open <url> - Open a website
• screenshot - Take a screenshot
• skills - List available skills`;
      }
      
      return { 
        error: errorMessage,
        fallbackResponse,
        needsApiKey: error.message.includes('401') || error.message.includes('404')
      };
    }
  }

  /**
   * Build prompt with skill context
   */
  buildPrompt(message, skill, context) {
    let prompt = '';

    // Add system prompt from skill
    if (skill && skill.systemPrompt) {
      prompt += `${skill.systemPrompt}\n\n`;
    }

    // Add conversation history
    if (context.length > 0) {
      prompt += 'Previous conversation:\n';
      for (const msg of context.slice(-5)) {  // Last 5 messages
        prompt += `${msg.role}: ${msg.content}\n`;
      }
      prompt += '\n';
    }

    // Add current message
    prompt += `User: ${message}\n`;

    if (skill && skill.name !== 'General') {
      prompt += `\n[Skill: ${skill.name}]`;
    }

    prompt += '\nAssistant:';

    return prompt;
  }

  /**
   * Stream response from LLM
   */
  async* streamResponse(message, context = []) {
    const skill = skillManager.getSkill('general');
    const prompt = this.buildPrompt(message, skill, context);

    try {
      for await (const chunk of nvidiaClient.streamMessage(prompt, context)) {
        yield chunk;
      }
    } catch (error) {
      logger.error('Stream error:', error);
      yield `Error: ${error.message}`;
    }
  }

  /**
   * Process with specific skill
   */
  async processWithSkill(message, skillName, context = []) {
    return this.processMessage(message, { skillName, context });
  }

  /**
   * Get available skills
   */
  getSkills() {
    return skillManager.getEnabledSkills().map(s => ({
      name: s.name,
      description: s.description,
      capabilities: s.capabilities.map(c => c.name)
    }));
  }

  /**
   * Reload skills
   */
  async reloadSkills() {
    await skillManager.reloadAll();
    logger.success('Skills reloaded');
  }

  /**
   * Get session history
   */
  getHistory(limit = 10) {
    return this.sessionHistory.slice(-limit);
  }

  /**
   * Clear session history
   */
  clearHistory() {
    this.sessionHistory = [];
  }

  /**
   * Set current skill
   */
  setSkill(skillName) {
    const skill = skillManager.getSkill(skillName);
    if (skill) {
      this.currentSkill = skill;
      return true;
    }
    return false;
  }
}

export const agent = new Agent();
export default agent;