/**
 * Simple logger utility
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

function formatMessage(level: string, ...args: any[]): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ')}`;
}

export const logger = {
  debug: (...args: any[]) => {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', ...args));
    }
  },
  info: (...args: any[]) => {
    if (shouldLog('info')) {
      console.log(formatMessage('info', ...args));
    }
  },
  warn: (...args: any[]) => {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', ...args));
    }
  },
  error: (...args: any[]) => {
    if (shouldLog('error')) {
      console.error(formatMessage('error', ...args));
    }
  },
};
