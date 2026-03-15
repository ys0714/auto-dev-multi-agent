import fs from 'fs';
import path from 'path';
import { GLOBAL_DIR } from '../../infra/config';

export interface UserProfile {
  name?: string;
  preferredLanguage?: string;
  customRules?: string[];
  autoCompactThreshold?: number;
  environmentVars?: Record<string, string>;
}

export class ProfileManager {
  private configDir: string;
  private profilePath: string;
  private profile: UserProfile;

  constructor(globalDir?: string) {
    this.configDir = globalDir || GLOBAL_DIR;
    this.profilePath = path.join(this.configDir, 'user-profile.json');
    this.profile = this.load();
  }

  private ensureConfigDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private load(): UserProfile {
    this.ensureConfigDir();
    if (fs.existsSync(this.profilePath)) {
      try {
        const data = fs.readFileSync(this.profilePath, 'utf-8');
        return JSON.parse(data);
      } catch (e) {
        console.error('Failed to parse user profile, using defaults.', e);
        return this.getDefaults();
      }
    }
    const defaults = this.getDefaults();
    this.save(defaults);
    return defaults;
  }

  private getDefaults(): UserProfile {
    return {
      preferredLanguage: 'English',
      autoCompactThreshold: 100000,
      customRules: []
    };
  }

  get(): UserProfile {
    return this.profile;
  }

  update(updates: Partial<UserProfile>): void {
    this.profile = { ...this.profile, ...updates };
    this.save(this.profile);
  }

  private save(profile: UserProfile): void {
    this.ensureConfigDir();
    fs.writeFileSync(this.profilePath, JSON.stringify(profile, null, 2));
  }

  getSystemPromptSnippet(): string {
    const p = this.profile;
    const parts = [];
    if (p.name) parts.push(`User Name: ${p.name}`);
    if (p.preferredLanguage) parts.push(`Preferred Language: ${p.preferredLanguage}`);
    if (p.customRules && p.customRules.length > 0) {
      parts.push(`User Custom Rules:\n- ${p.customRules.join('\n- ')}`);
    }
    return parts.join('\n');
  }
}
