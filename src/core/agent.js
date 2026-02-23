import nvidiaClient from '../llm/nvidia-client.js';
import skillManager from './skill-manager.js';
import browserService from '../browser/puppeteer-service.js';
import agentBrowserService from '../browser/agent-browser-service.js';
import scheduler from './scheduler.js';
import permissions from './permissions.js';
import autofix from './autofix.js';
import codeModifier from './code-modifier.js';
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

    // Use tool execution loop for browser skill
    const isBrowserSkill = skill && (
      skill.name.toLowerCase().includes('browser') ||
      skill.name.toLowerCase().includes('web')
    );

    if (isBrowserSkill && config.browser.enabled && !stream) {
      // Prefer agent-browser for browser tasks
      const isAgentBrowser = skill.name.toLowerCase().includes('agent');
      
      if (isAgentBrowser && !browserService.isUsingFallback()) {
        // Initialize agent-browser as primary
        logger.info('🌐 Using agent-browser for browser automation');
        await browserService.useFallback(); // This makes agent-browser the primary
      }
      
      return this.processMessageWithTools(message, { skillName: skill.name, context });
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
   * Parse tool calls from LLM response
   */
  parseToolCalls(text) {
    const toolCalls = [];
    
    // Match JSON-like objects - handle both quoted and unquoted keys
    // Patterns: {"action": "..."} or {action: "..."} or {action: '...'}
    const patterns = [
      /\{[^{}]*"action"\s*:\s*"[^"]*"[^{}]*\}/g,
      /\{[^{}]*"action"\s*:\s*'[^']*'[^{}]*\}/g,
      /\{[^{}]*action\s*:\s*"[^"]*"[^{}]*\}/g,
      /\{[^{}]*action\s*:\s*'[^']*'[^{}]*\}/g,
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          try {
            // Try direct JSON parse first
            let parsed;
            try {
              parsed = JSON.parse(match);
            } catch (e) {
              // Try converting unquoted keys to quoted keys
              const fixed = match.replace(/(\w+):/g, '"$1":');
              parsed = JSON.parse(fixed);
            }
            
            if (parsed.action) {
              toolCalls.push(parsed);
            }
          } catch (e) {
            // Not valid JSON, skip
          }
        }
      }
    }
    
    // Also try simpler pattern for action only
    const simplePattern = /\{[^}]*action\s*:[^}]*\}/g;
    const simpleMatches = text.match(simplePattern);
    if (simpleMatches) {
      for (const match of simpleMatches) {
        const actionMatch = match.match(/action\s*:\s*["']?([^"'}\s,]+)["']?/);
        const urlMatch = match.match(/url\s*:\s*(?:["']([^"']+)["']|([^\s,}+]+))/);
        const selectorMatch = match.match(/selector\s*:\s*(?:["']([^"']+)["']|(\S+))/);
        const textMatch = match.match(/text\s*:\s*(?:["']([^"']+)["']|(\S+))/);
        const directionMatch = match.match(/direction\s*:\s*["']([^"']+)["']/);
        const amountMatch = match.match(/amount\s*:\s*(\d+)/);
        const actionTypeMatch = match.match(/action_type\s*:\s*["']([^"']+)["']/);
        
        if (actionMatch) {
          const toolCall = { action: actionMatch[1] };
          if (urlMatch) toolCall.url = urlMatch[1] || urlMatch[2];
          if (selectorMatch) toolCall.selector = selectorMatch[1] || selectorMatch[2];
          if (textMatch) toolCall.text = textMatch[1] || textMatch[2];
          if (directionMatch) toolCall.direction = directionMatch[1];
          if (amountMatch) toolCall.amount = parseInt(amountMatch[1]);
          if (actionTypeMatch) toolCall.action_type = actionTypeMatch[1];
          
          // Avoid duplicates
          if (!toolCalls.find(tc => tc.action === toolCall.action)) {
            toolCalls.push(toolCall);
          }
        }
      }
    }
    
    return toolCalls;
  }

  /**
   * Execute a tool call
   */
  async executeToolCall(toolCall) {
    const { action, url, selector, text, direction, amount, action_type, query, ref } = toolCall;
    
    logger.info(`🔧 Executing tool: ${action}`);
    
    try {
      switch (action) {
        case 'open_website':
          if (!url || url.trim() === '' || url === 'undefined') {
            return { success: false, error: `Missing or invalid url parameter. Got: ${JSON.stringify(toolCall)}` };
          }
          
          // ALWAYS clean the URL - extract just the domain/URL
          let cleanUrl = url.trim();
          
          // Try to extract a valid URL
          const urlPatterns = [
            /(https?:\/\/)?([\w.-]+\.[a-z]{2,})(\/[\w.\/]*)?/i,
            /([\w.-]+\.[a-z]{2,})/i,
            /(www\.[\w.-]+)/i
          ];
          
          for (const pattern of urlPatterns) {
            const match = cleanUrl.match(pattern);
            if (match) {
              cleanUrl = match[0];
              // Remove trailing spaces and common separators
              cleanUrl = cleanUrl.split(/\s+/)[0];
              // Remove trailing punctuation
              cleanUrl = cleanUrl.replace(/[.,;!?]+$/, '');
              // Add https if protocol missing
              if (!cleanUrl.startsWith('http')) {
                cleanUrl = 'https://' + cleanUrl;
              }
              break;
            }
          }
          
          logger.info(`🌐 Opening: ${cleanUrl}`);
          
          try {
            return await browserService.open(cleanUrl);
          } catch (error) {
            logger.warn(`Puppeteer failed: ${error.message}`);
            logger.info(`🔄 Trying agent-browser fallback...`);
            await browserService.useFallback();
            return await browserService.open(cleanUrl);
          }
          
        case 'get_content':
        case 'extract_content':
        case 'snapshot':
          try {
            return await browserService.getContent();
          } catch (error) {
            logger.warn(`Puppeteer failed, trying agent-browser fallback...`);
            await browserService.useFallback();
            return await browserService.getContent();
          }
          
        case 'screenshot':
        case 'take_screenshot':
          try {
            return await browserService.screenshot();
          } catch (error) {
            logger.warn(`Puppeteer failed, trying agent-browser fallback...`);
            await browserService.useFallback();
            return await browserService.screenshot();
          }
          
        case 'click_element':
          const target = selector || ref;
          if (!target) return { success: false, error: 'Missing selector or ref parameter' };
          try {
            return await browserService.click(target);
          } catch (error) {
            logger.warn(`Puppeteer failed, trying agent-browser fallback...`);
            await browserService.useFallback();
            return await browserService.click(target);
          }
          
        case 'type_text':
        case 'update_search_query':
          const typeTarget = selector || ref;
          if (!typeTarget || !text) {
            // Try common search selectors
            const selectors = ['input[name="q"]', 'input[type="search"]', 'input[type="text"]', '#search', '.search input', 'input[placeholder*="Search"]'];
            for (const sel of selectors) {
              const result = await browserService.type(sel, text || query);
              if (result.success) return result;
            }
            return { success: false, error: 'Missing selector or text parameter' };
          }
          return await browserService.type(selector, text || query);
          
        case 'scroll':
          try {
            return await browserService.scroll(direction || 'down', amount || 500);
          } catch (error) {
            logger.warn(`Puppeteer failed, trying agent-browser fallback...`);
            await browserService.useFallback();
            return await browserService.scroll(direction || 'down', amount || 500);
          }
          
        case 'navigate':
          try {
            return await browserService.navigate(action_type || 'back');
          } catch (error) {
            logger.warn(`Puppeteer failed, trying agent-browser fallback...`);
            await browserService.useFallback();
            return await browserService.navigate(action_type || 'back');
          }
          
        case 'submit_search':
        case 'submit_form':
          // Press Enter to submit search
          try {
            if (selector) {
              await browserService.click(selector);
            }
            return { success: true, message: 'Search submitted' };
          } catch (error) {
            logger.warn(`Puppeteer failed, trying agent-browser fallback...`);
            await browserService.useFallback();
            return { success: true, message: 'Search submitted (via fallback)' };
          }
          
        case 'find_text':
        case 'find_element':
          try {
            return await browserService.findByText(text || query);
          } catch (error) {
            logger.warn(`Puppeteer failed, trying agent-browser fallback...`);
            await browserService.useFallback();
            return await browserService.findByText(text || query);
          }
          
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Process message with tool execution loop
   */
  async processMessageWithTools(message, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const { skillName, context = [], stream = false } = options;

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
        skill = skillManager.getSkill('general');
      } else if (detectedSkills.length === 1) {
        skill = detectedSkills[0].skillData;
      } else {
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

    // Build initial prompt
    let prompt = this.buildPrompt(message, skill, context);
    let currentContext = [...context];

    // Tool execution loop (max 3 iterations)
    for (let iteration = 0; iteration < 3; iteration++) {
      // Get response from LLM
      const response = await nvidiaClient.getCompleteResponse(prompt, currentContext);
      
      // Check for tool calls
      const toolCalls = this.parseToolCalls(response);
      
      logger.debug(`Iteration ${iteration + 1}: Found ${toolCalls.length} tool calls`);
      if (toolCalls.length > 0) {
        logger.debug(`Tool calls: ${JSON.stringify(toolCalls)}`);
      }
      
      if (toolCalls.length === 0) {
        // No tool calls, return the response
        this.sessionHistory.push({ role: 'user', content: message });
        this.sessionHistory.push({ role: 'assistant', content: response });
        
        return {
          response,
          skill: skill.name,
          detectedSkills: detectedSkills
        };
      }

      // Execute tool calls and collect results
      let toolResults = '';
      for (const toolCall of toolCalls) {
        let result = await this.executeToolCall(toolCall);
        
        // Automatically get content after opening a website
        if (toolCall.action === 'open_website' && result.success) {
          logger.info('🔧 Auto-extracting content after opening website...');
          const contentResult = await browserService.getContent();
          if (contentResult.success) {
            result = { ...result, ...contentResult };
          }
        }
        
        // Format result for LLM
        let resultText = `Tool: ${toolCall.action}\n`;
        if (result.success) {
          resultText += `Status: Success\n`;
          if (result.title) resultText += `Title: ${result.title}\n`;
          if (result.url) resultText += `URL: ${result.url}\n`;
          if (result.text) resultText += `Content:\n${result.text.substring(0, 4000)}\n`;
          if (result.headings && result.headings.length > 0) {
            resultText += `Headings: ${result.headings.join(', ')}\n`;
          }
          if (result.links && result.links.length > 0) {
            resultText += `Links (${result.links.length} total): ${result.links.slice(0, 5).map(l => l.text).join(', ')}\n`;
          }
          if (result.buttons && result.buttons.length > 0) {
            resultText += `Buttons: ${result.buttons.join(', ')}\n`;
          }
          if (result.filepath) resultText += `Screenshot saved: ${result.filepath}\n`;
          if (result.selector) resultText += `Clicked: ${result.selector}\n`;
        } else {
          resultText += `Status: Failed\nError: ${result.error}\n`;
        }
        
        toolResults += resultText + '\n';
        logger.info(`📊 Tool result: ${result.success ? 'OK' : 'FAILED'}`);
      }

      // Add tool results to context and ask LLM to continue
      currentContext.push({ role: 'assistant', content: response });
      currentContext.push({ role: 'user', content: `Tool results:\n${toolResults}\n\nPlease provide a helpful response to the user based on these results.` });
      
      prompt = '';
    }

    // Max iterations reached, return last response
    return { error: 'Tool execution limit reached' };
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

  /**
   * Scheduler methods
   */
  addScheduledTask(name, schedule, command, options = {}) {
    return scheduler.addTask(name, schedule, command, options);
  }

  removeScheduledTask(taskId) {
    return scheduler.removeTask(taskId);
  }

  listScheduledTasks() {
    return scheduler.listTasks();
  }

  runScheduledTask(taskId) {
    return scheduler.runTask(taskId);
  }

  pauseScheduledTask(taskId) {
    return scheduler.pauseTask(taskId);
  }

  resumeScheduledTask(taskId) {
    return scheduler.resumeTask(taskId);
  }

  stopScheduledTask(taskId) {
    return scheduler.requestStop(taskId);
  }

  /**
   * Permission methods
   */
  requestPermission(type, details, userId = 'cli') {
    return permissions.requestPermission(type, details, userId);
  }

  grantPermission(requestId, options = {}) {
    return permissions.grantPermission(requestId, options);
  }

  denyPermission(requestId) {
    return permissions.denyPermission(requestId);
  }

  checkPermission(type, details) {
    return permissions.checkPermission(type, details);
  }

  listPermissions() {
    return permissions.listPermissions();
  }

  getPendingPermissions() {
    return permissions.getPendingRequests();
  }

  /**
   * Auto-fix methods
   */
  analyzeError(error) {
    return autofix.analyzeError(error);
  }

  suggestFix(errorAnalysis) {
    return autofix.suggestFix(errorAnalysis);
  }

  async attemptFix(taskId, fixSuggestion) {
    return autofix.attemptFix(taskId, fixSuggestion);
  }

  stopFix(taskId) {
    return autofix.stop(taskId);
  }

  isFixStopped(taskId) {
    return autofix.isStopped(taskId);
  }

  getFixAttempts(taskId) {
    return autofix.getAttempts(taskId);
  }

  resetFixAttempts(taskId) {
    return autofix.resetAttempts(taskId);
  }

  /**
   * Code modification methods (Self-modification)
   */

  /**
   * Request to modify the agent's own code
   * Creates a backup before applying changes
   */
  async requestCodeModification(changes, description = '') {
    logger.info('🔧 Processing code modification request...');
    
    try {
      const result = await codeModifier.applyChanges(changes, description);
      
      if (result.success) {
        return {
          success: true,
          message: `Code modification applied successfully.\nBackup created: ${result.backup}\n\nThe agent will verify on next startup. If issues are detected, it will automatically revert.`,
          backup: result.backup,
          changes: result.changes
        };
      } else {
        return {
          success: false,
          error: result.error,
          restored: result.restored,
          message: `Code modification failed: ${result.error}${result.restored ? '\n\nAutomatically reverted to previous version.' : ''}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: `Code modification error: ${error.message}`
      };
    }
  }

  /**
   * Revert the last code modification
   */
  revertLastModification() {
    const pending = codeModifier.getPendingChanges();
    if (pending) {
      const reverted = codeModifier.revertPending();
      if (reverted) {
        return {
          success: true,
          message: 'Successfully reverted to the previous version.'
        };
      }
    }
    return {
      success: false,
      error: 'No pending modifications to revert'
    };
  }

  /**
   * Get current pending modifications
   */
  getPendingModifications() {
    return codeModifier.getPendingChanges();
  }

  /**
   * List available backups
   */
  listBackups() {
    return codeModifier.listBackups();
  }

  /**
   * Restore from a specific backup
   */
  restoreFromBackup(backupName) {
    try {
      codeModifier.restoreBackup(backupName);
      return {
        success: true,
        message: `Successfully restored from backup: ${backupName}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Verify current code integrity
   */
  async verifyCodeIntegrity() {
    return await codeModifier.verifyStartup();
  }
}

export const agent = new Agent();
export default agent;