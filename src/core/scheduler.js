import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import agent from './agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEDULES_DIR = join(__dirname, '../../data/schedules');

class Scheduler {
  constructor() {
    this.tasks = new Map();
    this.runningTasks = new Map();
    this.stopFlags = new Map();
    this.ensureStorageDir();
    this.loadTasks();
  }

  ensureStorageDir() {
    if (!existsSync(SCHEDULES_DIR)) {
      mkdirSync(SCHEDULES_DIR, { recursive: true });
    }
  }

  loadTasks() {
    try {
      const files = readdirSync(SCHEDULES_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const filepath = join(SCHEDULES_DIR, file);
        const data = JSON.parse(readFileSync(filepath, 'utf8'));
        this.tasks.set(data.id, data);
        if (data.enabled && data.type !== 'one-time') {
          this.scheduleTask(data);
        }
      }
      logger.info(`📅 Loaded ${this.tasks.size} scheduled tasks`);
    } catch (error) {
      logger.error('Failed to load scheduled tasks:', error.message);
    }
  }

  saveTask(task) {
    const filepath = join(SCHEDULES_DIR, `${task.id}.json`);
    writeFileSync(filepath, JSON.stringify(task, null, 2));
  }

  generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  parseSchedule(scheduleStr) {
    const str = scheduleStr.toLowerCase().trim();
    
    const oneTimeMatch = str.match(/at\s+(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2})/);
    if (oneTimeMatch) {
      return { type: 'one-time', datetime: oneTimeMatch[1] };
    }

    const heartbeatMatch = str.match(/every\s+(\d+)\s*(minute|minutes|hour|hours|day|days)/);
    if (heartbeatMatch) {
      const value = parseInt(heartbeatMatch[1]);
      const unit = heartbeatMatch[2];
      let interval;
      if (unit.startsWith('minute')) interval = value * 60 * 1000;
      else if (unit.startsWith('hour')) interval = value * 60 * 60 * 1000;
      else interval = value * 24 * 60 * 60 * 1000;
      return { type: 'heartbeat', interval };
    }

    const dailyMatch = str.match(/daily\s+at\s+(\d{1,2}:\d{2})/);
    if (dailyMatch) {
      return { type: 'recurring', cron: `0 ${dailyMatch[1].split(':')[1]} ${dailyMatch[1].split(':')[0]} * * *` };
    }

    const weeklyMatch = str.match(/weekly\s+on\s+(\w+)\s+at\s+(\d{1,2}:\d{2})/);
    if (weeklyMatch) {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayIndex = days.indexOf(weeklyMatch[1].toLowerCase());
      return { type: 'recurring', cron: `0 ${weeklyMatch[2].split(':')[1]} ${weeklyMatch[2].split(':')[0]} * * ${dayIndex}` };
    }

    const monthlyMatch = str.match(/monthly\s+on\s+(\d{1,2})\s+at\s+(\d{1,2}:\d{2})/);
    if (monthlyMatch) {
      return { type: 'recurring', cron: `0 ${monthlyMatch[2].split(':')[1]} ${monthlyMatch[2].split(':')[0]} ${monthlyMatch[1]} * *` };
    }

    return null;
  }

  addTask(name, scheduleStr, command, options = {}) {
    const parsed = this.parseSchedule(scheduleStr);
    if (!parsed) {
      throw new Error(`Invalid schedule format: ${scheduleStr}. Use formats like: "at 2026-02-20 14:00", "every 30 minutes", "daily at 9am", "weekly on monday at 9am"`);
    }

    const task = {
      id: this.generateId(),
      name,
      type: parsed.type,
      schedule: scheduleStr,
      command,
      skill: options.skill || null,
      context: options.context || [],
      interval: parsed.interval || null,
      cron: parsed.cron || null,
      datetime: parsed.datetime || null,
      enabled: true,
      maxAttempts: options.maxAttempts || 5,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: null,
      runCount: 0,
      successCount: 0,
      failureCount: 0
    };

    this.tasks.set(task.id, task);
    this.saveTask(task);

    if (task.enabled && task.type !== 'one-time') {
      this.scheduleTask(task);
    }

    logger.success(`📅 Scheduled task: "${name}" (${task.type})`);
    return task;
  }

  scheduleTask(task) {
    if (task.type === 'one-time') {
      const delay = new Date(task.datetime).getTime() - Date.now();
      if (delay > 0) {
        task.timeout = setTimeout(() => this.runTask(task.id), delay);
        task.nextRun = task.datetime;
      }
    } else if (task.type === 'heartbeat') {
      task.intervalId = setInterval(() => this.runTask(task.id), task.interval);
      task.nextRun = new Date(Date.now() + task.interval).toISOString();
    } else if (task.type === 'recurring' && task.cron) {
      this.scheduleCronTask(task);
    }
  }

  scheduleCronTask(task) {
    const runCron = () => {
      const now = new Date();
      const [second, minute, hour, dayOfMonth, month, dayOfWeek] = task.cron.split(' ');
      
      const matches = (field, value) => {
        if (field === '*') return true;
        if (field.includes(',')) return field.split(',').includes(String(value));
        if (field.includes('-')) {
          const [start, end] = field.split('-').map(Number);
          return value >= start && value <= end;
        }
        if (field.includes('/')) {
          const [, step] = field.split('/');
          return parseInt(value) % parseInt(step) === 0;
        }
        return parseInt(field) === parseInt(value);
      };

      const current = {
        second: now.getSeconds(),
        minute: now.getMinutes(),
        hour: now.getHours(),
        dayOfMonth: now.getDate(),
        month: now.getMonth() + 1,
        dayOfWeek: now.getDay()
      };

      const cronFields = task.cron.split(' ');
      
      if (cronFields.every((field, i) => matches(field, current[cronFields[i]] || current[Object.keys(current)[i]]))) {
        this.runTask(task.id);
      }
    };

    task.cronId = setInterval(runCron, 60000);
    task.nextRun = new Date(Date.now() + 60000).toISOString();
  }

  async runTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.error(`Task ${taskId} not found`);
      return;
    }

    if (this.runningTasks.has(taskId)) {
      logger.warn(`Task "${task.name}" is already running, skipping this cycle`);
      return;
    }

    if (this.stopFlags.get(taskId)) {
      logger.info(`Task "${task.name}" marked stop, skipping`);
      return;
    }

    this.runningTasks.set(taskId, true);
    logger.info(`📅 Running task: "${task.name}"`);

    try {
      const result = await agent.processMessage(task.command, { 
        skillName: task.skill || undefined,
        context: task.context || []
      });

      task.lastRun = new Date().toISOString();
      task.runCount++;
      task.successCount++;

      if (result.error) {
        task.failureCount++;
        logger.warn(`Task "${task.name}" completed with error: ${result.error}`);
      } else {
        logger.success(`Task "${task.name}" completed successfully`);
      }
    } catch (error) {
      task.lastRun = new Date().toISOString();
      task.runCount++;
      task.failureCount++;
      logger.error(`Task "${task.name}" failed: ${error.message}`);
    } finally {
      this.runningTasks.delete(taskId);
      this.saveTask(task);
    }
  }

  removeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    this.stopTask(taskId);

    this.tasks.delete(taskId);
    
    const filepath = join(SCHEDULES_DIR, `${taskId}.json`);
    try {
      if (existsSync(filepath)) {
        unlinkSync(filepath);
      }
    } catch (e) {}

    logger.success(`📅 Removed task: "${task.name}"`);
    return { success: true };
  }

  pauseTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    task.enabled = false;
    this.stopTask(taskId);
    this.saveTask(task);

    logger.info(`📅 Paused task: "${task.name}"`);
    return { success: true };
  }

  resumeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    task.enabled = true;
    if (task.type !== 'one-time') {
      this.scheduleTask(task);
    }
    this.saveTask(task);

    logger.info(`📅 Resumed task: "${task.name}"`);
    return { success: true };
  }

  stopTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      if (task.timeout) clearTimeout(task.timeout);
      if (task.intervalId) clearInterval(task.intervalId);
      if (task.cronId) clearInterval(task.cronId);
    }
    this.runningTasks.delete(taskId);
  }

  requestStop(taskId) {
    this.stopFlags.set(taskId, true);
    this.runningTasks.delete(taskId);
    logger.info(`📅 Stop requested for task: "${taskId}"`);
  }

  listTasks() {
    return Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      name: t.name,
      type: t.type,
      schedule: t.schedule,
      enabled: t.enabled,
      lastRun: t.lastRun,
      nextRun: t.nextRun,
      runCount: t.runCount,
      successCount: t.successCount,
      failureCount: t.failureCount
    }));
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  isRunning(taskId) {
    return this.runningTasks.has(taskId);
  }

  isStopped(taskId) {
    return this.stopFlags.get(taskId) || false;
  }

  shutdown() {
    for (const task of this.tasks.values()) {
      this.stopTask(task.id);
    }
    logger.info('📅 Scheduler shutdown complete');
  }
}

export const scheduler = new Scheduler();
export default scheduler;
