import fs from 'fs';
import path from 'path';
import { logger } from './logger';

export class EnvManager {
  private envPath: string;

  constructor(envPath?: string) {
    this.envPath = envPath || path.join(process.cwd(), '.env');
  }

  /**
   * Read current .env file and parse it into key-value pairs
   */
  private readEnvFile(): Map<string, string> {
    const envMap = new Map<string, string>();

    if (!fs.existsSync(this.envPath)) {
      logger.warn('.env file not found, will create new one');
      return envMap;
    }

    const content = fs.readFileSync(this.envPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const equalIndex = trimmed.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim();
        const value = trimmed.substring(equalIndex + 1).trim();
        envMap.set(key, value);
      }
    }

    return envMap;
  }

  /**
   * Write key-value pairs back to .env file, preserving comments and structure
   */
  private writeEnvFile(updates: Map<string, string>): void {
    let content = '';

    if (fs.existsSync(this.envPath)) {
      content = fs.readFileSync(this.envPath, 'utf-8');
    } else {
      // Create basic structure if file doesn't exist
      content = `# Telegram API credentials (get from https://my.telegram.org)
API_ID=
API_HASH=

# Session string (will be generated on first run)
SESSION_STRING=

# Telegram channel to monitor
CHANNEL_USERNAME=pat_cherkasyoblenergo

# API Server configuration
PORT=8080
HOST=0.0.0.0

# Logging level (debug, info, warn, error)
LOG_LEVEL=info
`;
    }

    const lines = content.split('\n');
    const processedKeys = new Set<string>();

    // Update existing keys
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const equalIndex = trimmed.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim();

        if (updates.has(key)) {
          const value = updates.get(key);
          lines[i] = `${key}=${value}`;
          processedKeys.add(key);
        }
      }
    }

    // Add new keys that weren't in the file
    for (const [key, value] of updates.entries()) {
      if (!processedKeys.has(key)) {
        lines.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(this.envPath, lines.join('\n'), 'utf-8');
    logger.info('Successfully updated .env file');
  }

  /**
   * Update multiple environment variables
   */
  public updateVariables(updates: Record<string, string>): void {
    const envMap = this.readEnvFile();

    for (const [key, value] of Object.entries(updates)) {
      envMap.set(key, value);
      // Also update in current process
      process.env[key] = value;
    }

    this.writeEnvFile(envMap);
  }

  /**
   * Get current value of an environment variable
   */
  public getVariable(key: string): string | undefined {
    return process.env[key];
  }

  /**
   * Check if all required Telegram credentials are configured
   */
  public hasRequiredCredentials(): boolean {
    const apiId = process.env.API_ID;
    const apiHash = process.env.API_HASH;
    const sessionString = process.env.SESSION_STRING;

    return !!(
      apiId &&
      !apiId.startsWith('your_') &&
      apiHash &&
      !apiHash.startsWith('your_') &&
      sessionString &&
      sessionString.length > 0
    );
  }

  /**
   * Check if API credentials are configured (even without session)
   */
  public hasApiCredentials(): boolean {
    const apiId = process.env.API_ID;
    const apiHash = process.env.API_HASH;

    return !!(
      apiId &&
      !apiId.startsWith('your_') &&
      apiHash &&
      !apiHash.startsWith('your_')
    );
  }
}
