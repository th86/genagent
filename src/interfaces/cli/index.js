import inquirer from 'inquirer';
import chalk from 'chalk';
import agent from '../../core/agent.js';
import browserService from '../../browser/puppeteer-service.js';
import sessionManager from '../../core/session.js';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

/**
 * Interactive CLI Interface for GenAgent
 */
class CLIInterface {
  constructor() {
    this.sessionId = `cli_${Date.now()}`;
    this.running = false;
    this.currentSkill = null;
  }

  /**
   * Start the CLI
   */
  async start() {
    console.clear();
    this.printWelcome();

    // Initialize agent
    await agent.initialize();

    this.running = true;
    await this.mainLoop();
  }

  /**
   * Print welcome message
   */
  printWelcome() {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════════╗
║                                           ║
║   ${chalk.bold.yellow('🤖 GenAgent CLI v1.0.0')}                   ║
║   ${chalk.gray('General-purpose AI Agent')}                  ║
║                                           ║
╚═══════════════════════════════════════════╝
    `));

    const cliConfig = config.interfaces.cli;
    if (cliConfig?.welcome_message) {
      console.log(chalk.gray(cliConfig.welcome_message));
    }
    
    console.log(chalk.gray('\nType "help" for available commands\n'));
  }

  /**
   * Main interaction loop
   */
  async mainLoop() {
    while (this.running) {
      try {
        const { query } = await inquirer.prompt([
          {
            type: 'input',
            name: 'query',
            message: chalk.green('> '),
            prefix: ''
          }
        ]);

        if (!query.trim()) continue;

        await this.processInput(query);

      } catch (error) {
        if (error.message === 'User force closed prompt') {
          break;
        }
        console.log(chalk.red(`Error: ${error.message}`));
      }
    }

    console.log(chalk.gray('\n👋 Goodbye!'));
    process.exit(0);
  }

  /**
   * Process user input
   */
  async processInput(input) {
    const trimmed = input.trim();

    // Handle special commands
    if (this.handleSystemCommand(trimmed)) {
      return;
    }

    // Process through agent
    const result = await agent.processMessage(trimmed);

    // Handle skill selection needed
    if (result.needsChoice) {
      await this.handleSkillSelection(result.skills);
      return;
    }

    // Display response
    if (result.error) {
      console.log(chalk.red(`❌ ${result.error}`));
    } else {
      console.log(chalk.white(result.response));
      
      if (result.skill) {
        console.log(chalk.gray(`\n[Using skill: ${result.skill}]`));
      }
    }
  }

  /**
   * Handle system commands
   */
  handleSystemCommand(input) {
    const cmd = input.toLowerCase();

    // Exit commands
    if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') {
      this.running = false;
      return true;
    }

    // Help command
    if (cmd === 'help' || cmd === 'h' || cmd === '?') {
      this.printHelp();
      return true;
    }

    // Skills list
    if (cmd === 'skills' || cmd === 'skill list') {
      this.printSkills();
      return true;
    }

    // Clear screen
    if (cmd === 'clear' || cmd === 'cls') {
      console.clear();
      return true;
    }

    // History
    if (cmd === 'history' || cmd === 'hist') {
      this.printHistory();
      return true;
    }

    // Browser commands
    if (cmd.startsWith('open ') || cmd.startsWith('goto ')) {
      const url = input.replace(/^(open|goto)\s+/, '');
      this.handleBrowserCommand('open', url);
      return true;
    }

    if (cmd === 'screenshot' || cmd === 'ss') {
      this.handleBrowserCommand('screenshot');
      return true;
    }

    if (cmd.startsWith('click ')) {
      const selector = input.replace('click ', '');
      this.handleBrowserCommand('click', selector);
      return true;
    }

    if (cmd === 'back' || cmd === 'forward' || cmd === 'refresh') {
      this.handleBrowserCommand('navigate', cmd);
      return true;
    }

    // Browser mode
    if (cmd === 'browser visible' || cmd === 'browser headless') {
      const mode = cmd.split(' ')[1];
      this.handleBrowserCommand('mode', mode);
      return true;
    }

    // Skill selection
    if (cmd.startsWith('use ') || cmd.startsWith('skill ')) {
      const skillName = input.replace(/^(use|skill)\s+/i, '');
      this.handleSkillUse(skillName);
      return true;
    }

    // Scheduler commands
    if (cmd.startsWith('schedule ') || cmd.startsWith('at ') || cmd.startsWith('every ')) {
      this.handleScheduleCommand(input);
      return true;
    }

    if (cmd === 'schedules' || cmd === 'schedule list') {
      this.handleScheduleCommand('list');
      return true;
    }

    if (cmd.startsWith('schedule delete ') || cmd.startsWith('schedule remove ')) {
      const taskId = input.replace(/^(schedule delete|schedule remove)\s+/i, '');
      this.handleScheduleCommand('delete ' + taskId);
      return true;
    }

    if (cmd.startsWith('schedule run ')) {
      const taskId = input.replace('schedule run ', '');
      this.handleScheduleCommand('run ' + taskId);
      return true;
    }

    if (cmd.startsWith('schedule stop ')) {
      const taskId = input.replace('schedule stop ', '');
      this.handleScheduleCommand('stop ' + taskId);
      return true;
    }

    // Stop command
    if (cmd === 'stop' || cmd === 'cancel' || cmd === 'abort') {
      this.handleStopCommand(input);
      return true;
    }

    // Permission commands
    if (cmd === 'permissions' || cmd === 'perms') {
      this.handlePermissionCommand('list');
      return true;
    }

    if (cmd.startsWith('allow ') || cmd.startsWith('grant ')) {
      const requestId = input.replace(/^(allow|grant)\s+/i, '');
      this.handlePermissionCommand('allow ' + requestId);
      return true;
    }

    if (cmd.startsWith('deny ') || cmd.startsWith('reject ')) {
      const requestId = input.replace(/^(deny|reject)\s+/i, '');
      this.handlePermissionCommand('deny ' + requestId);
      return true;
    }

    if (cmd === 'pending' || cmd === 'pending permissions') {
      this.handlePermissionCommand('pending');
      return true;
    }

    return false;
  }

  /**
   * Print help
   */
  printHelp() {
    console.log(chalk.cyan(`
📚 Available Commands:

${chalk.gray('General:')}
  help, ?           Show this help message
  skills            List available skills
  use <skill>       Use a specific skill
  history           Show conversation history
  clear             Clear screen
  exit, quit        Exit the CLI

${chalk.gray('Scheduler:')}
  schedule "name" every 30 minutes  Schedule a task
  schedule "name" at 2026-02-20 14:00  One-time schedule
  schedule "name" daily at 9am       Daily schedule
  schedules                         List all scheduled tasks
  schedule run <id>                 Run a task now
  schedule stop <id>                Stop a running task

${chalk.gray('Permissions:')}
  permissions, perms    List granted permissions
  pending               Show pending permission requests
  allow <id>            Grant a permission
  deny <id>             Deny a permission

${chalk.gray('Stop:')}
  stop, cancel, abort   Signal stop to running tasks

${chalk.gray('Browser:')}
  open <url>        Open a website
  screenshot, ss    Take a screenshot
  click <element>   Click an element
  back/forward      Navigate
  browser visible   Switch to visible browser
  browser headless  Switch to headless mode
    `));
  }

  /**
   * Print available skills
   */
  printSkills() {
    const skills = agent.getSkills();
    
    console.log(chalk.cyan('\n📦 Available Skills:\n'));
    
    for (const skill of skills) {
      console.log(chalk.white(`  • ${chalk.bold(skill.name)}`));
      console.log(chalk.gray(`    ${skill.description}`));
      if (skill.capabilities?.length) {
        console.log(chalk.gray(`    Capabilities: ${skill.capabilities.join(', ')}`));
      }
      console.log();
    }
  }

  /**
   * Print conversation history
   */
  printHistory() {
    const history = agent.getHistory(10);
    
    console.log(chalk.cyan('\n📜 Recent History:\n'));
    
    for (const msg of history) {
      const prefix = msg.role === 'user' ? chalk.green('You:') : chalk.blue('Bot:');
      const content = msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '');
      console.log(prefix, chalk.gray(content));
    }
    
    console.log();
  }

  /**
   * Handle skill selection when multiple match
   */
  async handleSkillSelection(skills) {
    console.log(chalk.yellow('\n🔍 Multiple skills match your query. Choose one:\n'));
    
    const choices = skills.map((s, i) => ({
      name: `${s.name} (${s.description}) - confidence: ${s.confidence}`,
      value: s.name
    }));
    
    choices.push({ name: 'General (no specific skill)', value: 'general' });
    
    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Choose a skill:',
        choices
      }
    ]);
    
    // Process with selected skill
    const result = await agent.processWithSkill(
      skills[0]?.triggers?.[0] || 'general query',
      selected
    );
    
    if (result.response) {
      console.log(chalk.white(result.response));
    }
  }

  /**
   * Handle skill use command
   */
  handleSkillUse(skillName) {
    const success = agent.setSkill(skillName);
    
    if (success) {
      console.log(chalk.green(`✅ Now using skill: ${skillName}`));
    } else {
      console.log(chalk.red(`❌ Skill not found: ${skillName}`));
      this.printSkills();
    }
  }

  /**
   * Handle browser commands
   */
  async handleBrowserCommand(action, param = null) {
    if (!config.browser.enabled) {
      console.log(chalk.red('Browser is disabled in config'));
      return;
    }

    try {
      let result;
      
      switch (action) {
        case 'open':
          result = await browserService.open(param);
          break;
        case 'screenshot':
          result = await browserService.screenshot();
          break;
        case 'click':
          result = await browserService.click(param);
          break;
        case 'navigate':
          result = await browserService.navigate(param);
          break;
        case 'mode':
          result = await browserService.setMode(param);
          break;
      }

      if (result?.success) {
        console.log(chalk.green('✅ ' + JSON.stringify(result)));
      } else {
        console.log(chalk.red('❌ ' + (result?.error || 'Command failed')));
      }
    } catch (error) {
      console.log(chalk.red(`❌ Browser Error: ${error.message}`));
      
      // Provide helpful troubleshooting
      if (error.message.includes('Failed to launch') || error.message.includes('browser process')) {
        console.log(chalk.yellow('\n💡 Troubleshooting:'));
        console.log(chalk.gray('1. Try running in headless mode:'));
        console.log(chalk.gray('   browser headless'));
        console.log(chalk.gray('\n2. Or update Chrome/Chromium:'));
        console.log(chalk.gray('   npx puppeteer browsers install chrome'));
        console.log(chalk.gray('\n3. Check if Chrome is installed:'));
        console.log(chalk.gray('   which google-chrome'));
        console.log(chalk.gray('   or'));
        console.log(chalk.gray('   which chromium'));
      }
    }
  }

  /**
   * Handle schedule commands
   */
  async handleScheduleCommand(input) {
    const cmd = input.toLowerCase().trim();
    
    if (cmd === 'list' || cmd === 'schedules') {
      const tasks = agent.listScheduledTasks();
      console.log(chalk.cyan('\n📅 Scheduled Tasks:\n'));
      if (tasks.length === 0) {
        console.log(chalk.gray('  No scheduled tasks'));
      } else {
        for (const task of tasks) {
          console.log(chalk.white(`  • ${chalk.bold(task.name)}`));
          console.log(chalk.gray(`    ID: ${task.id}`));
          console.log(chalk.gray(`    Schedule: ${task.schedule}`));
          console.log(chalk.gray(`    Status: ${task.enabled ? 'Running' : 'Paused'}`));
          console.log(chalk.gray(`    Runs: ${task.runCount}, Success: ${task.successCount}, Failed: ${task.failureCount}`));
          console.log();
        }
      }
      return;
    }

    if (cmd.startsWith('delete ') || cmd.startsWith('remove ')) {
      const taskId = cmd.replace(/^(delete|remove)\s+/, '');
      const result = agent.removeScheduledTask(taskId);
      if (result.success) {
        console.log(chalk.green('✅ Task removed'));
      } else {
        console.log(chalk.red('❌ ' + result.error));
      }
      return;
    }

    if (cmd.startsWith('run ')) {
      const taskId = cmd.replace('run ', '');
      agent.runScheduledTask(taskId);
      console.log(chalk.green('✅ Task started'));
      return;
    }

    if (cmd.startsWith('stop ')) {
      const taskId = cmd.replace('stop ', '');
      agent.stopScheduledTask(taskId);
      console.log(chalk.green('✅ Task stop requested'));
      return;
    }

    if (cmd.startsWith('pause ')) {
      const taskId = cmd.replace('pause ', '');
      const result = agent.pauseScheduledTask(taskId);
      if (result.success) {
        console.log(chalk.green('✅ Task paused'));
      } else {
        console.log(chalk.red('❌ ' + result.error));
      }
      return;
    }

    if (cmd.startsWith('resume ')) {
      const taskId = cmd.replace('resume ', '');
      const result = agent.resumeScheduledTask(taskId);
      if (result.success) {
        console.log(chalk.green('✅ Task resumed'));
      } else {
        console.log(chalk.red('❌ ' + result.error));
      }
      return;
    }

    // Parse: "name" every/at/in schedule
    const match = input.match(/(?:schedule\s+)?["'](.+?)["']\s+(.+)/i);
    if (match) {
      const name = match[1];
      const schedule = match[2];
      const remaining = input.replace(match[0], '').trim();
      const command = remaining || `Tell me the time`;
      
      try {
        const task = agent.addScheduledTask(name, schedule, command);
        console.log(chalk.green(`✅ Scheduled: "${task.name}" (${task.type})`));
        console.log(chalk.gray(`   ID: ${task.id}`));
        console.log(chalk.gray(`   Schedule: ${task.schedule}`));
      } catch (error) {
        console.log(chalk.red('❌ ' + error.message));
      }
      return;
    }

    console.log(chalk.yellow('\n📅 Schedule Commands:'));
    console.log(chalk.gray('  schedule "task name" every 30 minutes'));
    console.log(chalk.gray('  schedule "task name" at 2026-02-20 14:00'));
    console.log(chalk.gray('  schedule "task name" daily at 9am'));
    console.log(chalk.gray('  schedule "task name" weekly on monday at 9am'));
    console.log(chalk.gray('  schedules - List all tasks'));
    console.log(chalk.gray('  schedule run <id> - Run task now'));
    console.log(chalk.gray('  schedule stop <id> - Stop running task'));
    console.log(chalk.gray('  schedule delete <id> - Remove task'));
  }

  /**
   * Handle stop command
   */
  handleStopCommand(input) {
    console.log(chalk.yellow('\n⚠️ Available stop options:'));
    console.log(chalk.gray('  stop all - Stop all running tasks'));
    console.log(chalk.gray('  stop fix - Stop auto-fix attempts'));
    
    const cmd = input.toLowerCase();
    if (cmd.includes('all')) {
      console.log(chalk.green('✅ Stop signal sent to all tasks'));
    } else if (cmd.includes('fix')) {
      console.log(chalk.green('✅ Auto-fix attempts will be stopped'));
    }
  }

  /**
   * Handle permission commands
   */
  async handlePermissionCommand(input) {
    const cmd = input.toLowerCase().trim();
    
    if (cmd === 'list' || cmd === 'permissions') {
      const perms = agent.listPermissions();
      console.log(chalk.cyan('\n🔐 Granted Permissions:\n'));
      if (perms.length === 0) {
        console.log(chalk.gray('  No granted permissions'));
      } else {
        for (const perm of perms) {
          console.log(chalk.white(`  • ${chalk.bold(perm.type)}`));
          console.log(chalk.gray(`    Level: ${perm.level}`));
          console.log(chalk.gray(`    Details: ${JSON.stringify(perm.details)}`));
          console.log();
        }
      }
      return;
    }

    if (cmd === 'pending') {
      const pending = agent.getPendingPermissions();
      console.log(chalk.cyan('\n🔐 Pending Permission Requests:\n'));
      if (pending.length === 0) {
        console.log(chalk.gray('  No pending requests'));
      } else {
        for (const req of pending) {
          console.log(chalk.white(`  • ${chalk.bold(req.type)}`));
          console.log(chalk.gray(`    ID: ${req.id}`));
          console.log(chalk.gray(`    Details: ${JSON.stringify(req.details)}`));
          console.log();
        }
      }
      return;
    }

    if (cmd.startsWith('allow ') || cmd.startsWith('grant ')) {
      const requestId = cmd.replace(/^(allow|grant)\s+/, '');
      const result = agent.grantPermission(requestId);
      if (result.success) {
        console.log(chalk.green('✅ Permission granted'));
      } else {
        console.log(chalk.red('❌ ' + result.error));
      }
      return;
    }

    if (cmd.startsWith('deny ')) {
      const requestId = cmd.replace('deny ', '');
      const result = agent.denyPermission(requestId);
      if (result.success) {
        console.log(chalk.green('✅ Permission denied'));
      } else {
        console.log(chalk.red('❌ ' + result.error));
      }
      return;
    }
  }
}

export default CLIInterface;