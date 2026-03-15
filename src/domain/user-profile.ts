import fs from 'fs';
import path from 'path';
import { USER_PROFILE_PATH } from '../infra/config';

export interface StableUserProfile {
  preferredLanguage?: 'zh-CN' | 'en-US';
  codingLanguages: string[];
  environment: {
    os?: 'macOS' | 'Windows' | 'Linux';
    shell?: string;
    packageManager?: 'npm' | 'pnpm' | 'yarn';
    nodeVersion?: string;
  };
  preferences: string[];
  recentFocus?: string;
  lastWorkspace?: string;
}

export interface UserProfileDoc {
  version: 2;
  updatedAt: string;
  stableProfile: StableUserProfile;
}

function emptyProfile(): UserProfileDoc {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    stableProfile: {
      codingLanguages: [],
      environment: {},
      preferences: []
    }
  };
}

export function readUserProfile(): UserProfileDoc {
  try {
    if (!fs.existsSync(USER_PROFILE_PATH)) {
      return emptyProfile();
    }
    const raw = fs.readFileSync(USER_PROFILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2 && parsed.stableProfile) {
      return parsed as UserProfileDoc;
    }
    return emptyProfile();
  } catch (e) {
    return emptyProfile();
  }
}

export function updateUserProfile(update: Partial<StableUserProfile>): boolean {
  const profile = readUserProfile();
  const nextProfile: StableUserProfile = {
    ...profile.stableProfile,
    codingLanguages: [...profile.stableProfile.codingLanguages],
    environment: { ...profile.stableProfile.environment },
    preferences: [...profile.stableProfile.preferences]
  };

  let changed = false;

  if (update.preferredLanguage && nextProfile.preferredLanguage !== update.preferredLanguage) {
    nextProfile.preferredLanguage = update.preferredLanguage;
    changed = true;
  }

  if (update.codingLanguages) {
    const newLangs = [...new Set([...nextProfile.codingLanguages, ...update.codingLanguages])];
    if (newLangs.length !== nextProfile.codingLanguages.length) {
      nextProfile.codingLanguages = newLangs;
      changed = true;
    }
  }

  if (update.environment) {
    if (update.environment.os && update.environment.os !== nextProfile.environment.os) {
      nextProfile.environment.os = update.environment.os;
      changed = true;
    }
    if (update.environment.shell && update.environment.shell !== nextProfile.environment.shell) {
      nextProfile.environment.shell = update.environment.shell;
      changed = true;
    }
  }

  if (update.recentFocus && update.recentFocus !== nextProfile.recentFocus) {
    nextProfile.recentFocus = update.recentFocus;
    changed = true;
  }

  if (update.lastWorkspace && update.lastWorkspace !== nextProfile.lastWorkspace) {
    nextProfile.lastWorkspace = update.lastWorkspace;
    changed = true;
  }

  if (!changed) return false;

  const nextDoc: UserProfileDoc = {
    version: 2,
    updatedAt: new Date().toISOString(),
    stableProfile: nextProfile
  };

  try {
    const dir = path.dirname(USER_PROFILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USER_PROFILE_PATH, JSON.stringify(nextDoc, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadUserProfileBrief(): string | undefined {
  const profile = readUserProfile();
  const sp = profile.stableProfile;
  const lines: string[] = [];
  if (sp.preferredLanguage) lines.push(`- preferred_language: ${sp.preferredLanguage}`);
  if (sp.codingLanguages.length > 0) lines.push(`- coding_languages: ${sp.codingLanguages.join(', ')}`);
  if (sp.environment.os || sp.environment.shell) {
    lines.push(
      `- environment: os=${sp.environment.os ?? 'unknown'}, shell=${sp.environment.shell ?? 'unknown'}`
    );
  }
  if (sp.preferences.length > 0) lines.push(`- preferences: ${sp.preferences.join(' | ')}`);
  if (sp.recentFocus) lines.push(`- recent_focus: ${sp.recentFocus}`);
  if (sp.lastWorkspace) lines.push(`- last_workspace: ${sp.lastWorkspace}`);
  
  if (lines.length === 0) return undefined;
  return lines.join('\n');
}
