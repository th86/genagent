import nvidiaClient from '../llm/nvidia-client.js';
import skillManager from './skill-manager.js';
import browserService from '../browser/puppeteer-service.js';
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
    const { action, url, selector, text, direction, amount, action_type } = toolCall;
    
    logger.info(`🔧 Executing tool: ${action}`);
    
    try {
      switch (action) {
        case 'open_website':
          if (!url || url.trim() === '' || url === 'undefined') {
            return { success: false, error: `Missing or invalid url parameter. Got: ${JSON.stringify(toolCall)}` };
          }
          return await browserService.open(url);
          
        case 'get_content':
        case 'extract_content':
          return await browserService.getContent();
          
        case 'screenshot':
        case 'take_screenshot':
          return await browserService.screenshot();
          
        case 'click_element':
          if (!selector) return { success: false, error: 'Missing selector parameter' };
          return await browserService.click(selector);
          
        case 'type_text':
          if (!selector || !text) return { success: false, error: 'Missing selector or text parameter' };
          return await browserService.type(selector, text);
          
        case 'scroll':
          return await browserService.scroll(direction || 'down', amount || 500);
          
        case 'navigate':
          return await browserService.navigate(action_type || 'back');
          
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
}

export const agent = new Agent();
export default agent;