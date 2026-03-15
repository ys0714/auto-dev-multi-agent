import fs from 'fs';
import path from 'path';
import { SKILLS_DIR } from '../../infra/config';

export class SkillLoader {
  private skills: Map<string, { meta: any, body: string }> = new Map();

  constructor() {
    if (fs.existsSync(SKILLS_DIR)) {
      this.loadSkills(SKILLS_DIR);
    }
  }

  private loadSkills(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.loadSkills(fullPath);
      } else if (entry.name === 'SKILL.md') {
        const text = fs.readFileSync(fullPath, 'utf-8');
        const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/);
        
        let meta: any = {};
        let body = text;
        
        if (match) {
          const metaStr = match[1];
          body = match[2].trim();
          
          metaStr.split('\n').forEach(line => {
            if (line.includes(':')) {
              const [k, v] = line.split(':', 2);
              meta[k.trim()] = v.trim();
            }
          });
        }
        
        const name = meta.name || path.basename(path.dirname(fullPath));
        this.skills.set(name, { meta, body });
      }
    }
  }

  descriptions(): string {
    if (this.skills.size === 0) return '(no skills)';
    return Array.from(this.skills.entries())
      .map(([name, skill]) => `  - ${name}: ${skill.meta.description || '-'}`)
      .join('\n');
  }

  load(name: string): string {
    const skill = this.skills.get(name);
    if (!skill) {
      return `Error: Unknown skill '${name}'. Available: ${Array.from(this.skills.keys()).join(', ')}`;
    }
    return `<skill name="${name}">\n${skill.body}\n</skill>`;
  }
}
