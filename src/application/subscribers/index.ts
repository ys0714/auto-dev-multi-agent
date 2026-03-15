import { UserProfileSubscriber } from './user-profile-subscriber';
import { SessionLogSubscriber, sessionLogSubscriber } from './session-log-subscriber';
import { CodeInspectorSubscriber } from './code-inspector-subscriber';
import { SecurityGuardSubscriber } from './security-guard-subscriber';

let userProfileSubscriber: UserProfileSubscriber | null = null;
let codeInspectorSubscriber: CodeInspectorSubscriber | null = null;
let securityGuardSubscriber: SecurityGuardSubscriber | null = null;

export function initSubscribers() {
  if (!userProfileSubscriber) {
    userProfileSubscriber = new UserProfileSubscriber();
  }
  if (!codeInspectorSubscriber) {
    codeInspectorSubscriber = new CodeInspectorSubscriber();
  }
  if (!securityGuardSubscriber) {
    securityGuardSubscriber = new SecurityGuardSubscriber();
  }
  // sessionLogSubscriber is already initialized and exported
}

export { sessionLogSubscriber, codeInspectorSubscriber, securityGuardSubscriber };