import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

interface Config {
  telegram: {
    apiId: number;
    apiHash: string;
    sessionString: string;
    channelUsername: string;
  };
  server: {
    port: number;
    host: string;
  };
  storage: {
    dataDir: string;
    schedulesFile: string;
  };
  logging: {
    level: string;
  };
}

function getEnvVar(name: string, required: boolean = true): string {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  if (value && value.startsWith('your_') && required) {
    throw new Error(
      `\n❌ Please configure your Telegram API credentials in .env file!\n` +
      `   Visit https://my.telegram.org to get API_ID and API_HASH\n` +
      `   Current ${name} value: "${value}" (this is a placeholder)\n`
    );
  }
  return value || '';
}

function getEnvNumber(name: string, defaultValue?: number): number {
  const value = process.env[name];
  if (!value) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    if (value.startsWith('your_')) {
      throw new Error(
        `\n❌ Please configure your Telegram API credentials in .env file!\n` +
        `   Visit https://my.telegram.org to get API_ID and API_HASH\n` +
        `   Current ${name} value: "${value}" (this is a placeholder)\n`
      );
    }
    throw new Error(`Invalid number for environment variable ${name}: ${value}`);
  }
  return parsed;
}

const config: Config = {
  telegram: {
    apiId: getEnvNumber('API_ID'),
    apiHash: getEnvVar('API_HASH'),
    sessionString: getEnvVar('SESSION_STRING', false),
    channelUsername: getEnvVar('CHANNEL_USERNAME', false) || 'cherkasyoblenergo',
  },
  server: {
    port: getEnvNumber('PORT', 3000),
    host: getEnvVar('HOST', false) || '0.0.0.0',
  },
  storage: {
    dataDir: getEnvVar('DATA_DIR', false) || './data',
    schedulesFile: path.join(getEnvVar('DATA_DIR', false) || './data', 'schedules.json'),
  },
  logging: {
    level: getEnvVar('LOG_LEVEL', false) || 'info',
  },
};

export default config;
