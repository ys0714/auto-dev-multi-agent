#!/usr/bin/env node
import { Command } from 'commander';
import { MessageBus } from '../application/services/message-bus';
import { TaskManager } from '../application/services/task-manager';
import { TeammateManager } from '../application/services/teammate';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

const program = new Command();
const bus = new MessageBus();
const taskMgr = new TaskManager();
const teamMgr = new TeammateManager(bus, taskMgr); // Plan registry not needed for CLI senders

program
  .name('agent-cli')
  .description('CLI tools for Agent interactions (Task Management & Messaging)')
  .version('1.0.0');

// Global option for sender identity
program
  .option('--from <name>', 'The name of the agent calling this command', 'agent');

// MESSAGING
program
  .command('send_message')
  .description('Send a message to another teammate')
  .requiredOption('--to <name>', 'Recipient name (e.g. lead)')
  .requiredOption('--content <text>', 'Message content')
  .option('--msg_type <type>', 'Message type', 'message')
  .action((options) => {
    const sender = program.opts().from;
    const result = bus.send(sender, options.to, options.content, options.msg_type);
    console.log(result);
  });

program
  .command('read_inbox')
  .description('Read and drain your inbox')
  .action(() => {
    const sender = program.opts().from;
    const result = bus.readInbox(sender);
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('broadcast')
  .description('Send message to all teammates')
  .requiredOption('--content <text>', 'Message content')
  .action((options) => {
    const sender = program.opts().from;
    // We need to reload config to get latest members
    const teamConfig = JSON.parse(fs.readFileSync('./.team/config.json', 'utf-8'));
    const names = teamConfig.members.map((m: any) => m.name);
    const result = bus.broadcast(sender, options.content, names);
    console.log(result);
  });

// TASK MANAGEMENT
program
  .command('task_create')
  .description('Create a persistent file task')
  .requiredOption('--subject <string>', 'Task subject')
  .option('--description <string>', 'Task description', '')
  .action((options) => {
    const result = taskMgr.create(options.subject, options.description);
    console.log(result);
  });

program
  .command('task_get')
  .description('Get task details by ID')
  .requiredOption('--id <number>', 'Task ID')
  .action((options) => {
    const result = taskMgr.get(parseInt(options.id, 10));
    console.log(result);
  });

program
  .command('task_update')
  .description('Update task status or dependencies')
  .requiredOption('--id <number>', 'Task ID')
  .option('--status <string>', 'pending, in_progress, completed, deleted')
  .option('--add_blocked_by <numbers...>', 'IDs that block this task')
  .option('--add_blocks <numbers...>', 'IDs this task blocks')
  .option('--owner <string>', 'Owner of the task')
  .action((options) => {
    const blockedBy = options.add_blocked_by ? options.add_blocked_by.map((n: string) => parseInt(n, 10)) : undefined;
    const blocks = options.add_blocks ? options.add_blocks.map((n: string) => parseInt(n, 10)) : undefined;
    const result = taskMgr.update(parseInt(options.id, 10), options.status, blockedBy, blocks, options.owner);
    console.log(result);
  });

program
  .command('task_list')
  .description('List all tasks')
  .action(() => {
    const result = taskMgr.listAll();
    console.log(result);
  });

program
  .command('claim_task')
  .description('Claim a task from the board')
  .requiredOption('--task_id <id>', 'Task ID to claim')
  .action((options) => {
    const sender = program.opts().from;
    const result = taskMgr.claim(parseInt(options.task_id, 10), sender);
    console.log(result);
  });

program
  .command('task_bind_worktree')
  .description('Bind a task to a worktree name')
  .requiredOption('--task_id <number>', 'Task ID')
  .requiredOption('--worktree <string>', 'Worktree name')
  .option('--owner <string>', 'Owner of the task')
  .action((options) => {
    const result = taskMgr.bindWorktree(parseInt(options.task_id, 10), options.worktree, options.owner);
    console.log(result);
  });

// TEAM & WORKFLOW
program
  .command('spawn_teammate')
  .description('Spawn a persistent autonomous teammate')
  .requiredOption('--name <string>', 'Teammate name')
  .requiredOption('--role <string>', 'Teammate role')
  .requiredOption('--prompt <string>', 'Initial prompt/instructions')
  .option('--schema_path <string>', 'Path to a JSON Schema file to enforce MapReduce structural output')
  .action((options) => {
    // We pass the schema path to TeammateManager so it can pass it to child process
    const result = teamMgr.spawn(options.name, options.role, options.prompt, options.schema_path);
    console.log(result);
  });

program
  .command('list_teammates')
  .description('List all teammates')
  .action(() => {
    const result = teamMgr.listAll();
    console.log(result);
  });

program
  .command('plan_request')
  .description('Request plan approval from the lead')
  .requiredOption('--plan <text>', 'The plan content to be approved')
  .action((options) => {
    const sender = program.opts().from;
    const reqId = uuidv4().slice(0, 8);
    const result = bus.send(sender, 'lead', options.plan, 'plan_approval_request', { 
      request_id: reqId, 
      plan: options.plan 
    });
    console.log(`Plan request sent. Request ID: ${reqId}\n${result}`);
  });

program
  .command('shutdown_request')
  .description('Request a teammate to shut down')
  .requiredOption('--teammate <string>', 'Name of teammate to shutdown')
  .action((options) => {
    const sender = program.opts().from;
    const reqId = uuidv4().slice(0, 8);
    const result = bus.send(sender, options.teammate, 'Please shut down.', 'shutdown_request', { request_id: reqId });
    console.log(`Shutdown request ${reqId} sent to '${options.teammate}'\n${result}`);
  });

program
  .command('shutdown_response')
  .description('Respond to a shutdown request')
  .requiredOption('--request_id <id>', 'The shutdown request ID')
  .requiredOption('--approve <boolean>', 'true to approve, false to reject')
  .option('--reason <text>', 'Reason for the response', '')
  .action((options) => {
    const sender = program.opts().from;
    const isApprove = options.approve === 'true';
    const result = bus.send(sender, 'lead', options.reason, 'shutdown_response', { 
      request_id: options.request_id, 
      approve: isApprove 
    });
    console.log(result);
  });

program
  .command('plan_approval')
  .description("Approve or reject a teammate's plan")
  .requiredOption('--to <name>', 'The teammate who requested the plan')
  .requiredOption('--request_id <id>', 'The plan request ID')
  .requiredOption('--approve <boolean>', 'true to approve, false to reject')
  .option('--feedback <text>', 'Feedback for the response', '')
  .action((options) => {
    const sender = program.opts().from; // usually 'lead'
    const isApprove = options.approve === 'true';
    const result = bus.send(sender, options.to, options.feedback, 'plan_approval_response', { 
      request_id: options.request_id, 
      approve: isApprove,
      feedback: options.feedback
    });
    console.log(result);
  });

program.parse(process.argv);
