import { exec } from 'child_process';
import { WORKDIR } from '../../infra/config';

export function runBash(command: string, timeout: number = 120000): Promise<string> {
  const dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];
  if (dangerous.some(d => command.includes(d))) {
    return Promise.resolve("Error: Dangerous command blocked");
  }

  return new Promise((resolve) => {
    const child = exec(command, { cwd: WORKDIR, timeout }, (error, stdout, stderr) => {
      if (error && error.signal === 'SIGTERM') {
        resolve(`Error: Timeout (${timeout / 1000}s)`);
        return;
      }
      const output = (stdout + stderr).trim();
      resolve(output ? output.slice(0, 50000) : "(no output)");
    });
  });
}
