#!/usr/bin/env node

import CLIInterface from './src/interfaces/cli/index.js';

const cli = new CLIInterface();
cli.start().catch(error => {
  console.error('CLI Error:', error);
  process.exit(1);
});