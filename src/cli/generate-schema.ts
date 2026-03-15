#!/usr/bin/env node
import { Command } from 'commander';
import { client } from '../infra/adapters/llm';
import { MODEL_ID, SCHEMAS_DIR } from '../infra/config';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const program = new Command();

program
  .name('generate-schema')
  .description('Convert natural language description into a JSON Schema')
  .requiredOption('--description <string>', 'Natural language description of the desired output')
  .action(async (options) => {
    try {
      const prompt = `You are a strict JSON schema generator.
Given the following natural language description of an expected data structure, output ONLY a valid JSON Schema (Draft 7) representing it.
Do not wrap it in markdown block quotes. Do not add any explanation. ONLY output the raw JSON object.

Description:
${options.description}`;

      const response = await client.messages.create({
        model: MODEL_ID,
        system: "You output only valid raw JSON.",
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      });

      const schemaStr = (response.content[0] as any).text.trim().replace(/^```json\s*/, '').replace(/```$/, '').trim();
      JSON.parse(schemaStr); // Validate JSON

      if (!fs.existsSync(SCHEMAS_DIR)) {
        fs.mkdirSync(SCHEMAS_DIR, { recursive: true });
      }

      const fileId = uuidv4().slice(0, 8);
      const schemaPath = path.join(SCHEMAS_DIR, `schema_${fileId}.json`);
      
      fs.writeFileSync(schemaPath, schemaStr);
      console.log(`Schema successfully generated and saved to: ${schemaPath}`);
    } catch (e: any) {
      console.error('Error generating schema:', e.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
