import { TelegramChannelMonitor } from './telegram/client';
import { ScheduleParser } from './parsers/scheduleParser';
import { DataManager } from './storage/dataManager';
import { ApiServer } from './api/server';
import { EnvManager } from './utils/envManager';
import config from './config';
import { logger } from './utils/logger';
import { Api } from 'telegram/tl';

class FiatLuxService {
  private telegramMonitor?: TelegramChannelMonitor;
  private dataManager: DataManager;
  private apiServer: ApiServer;
  private envManager: EnvManager;
  private isShuttingDown = false;
  private isTelegramConnected = false;
  private pollingInterval?: ReturnType<typeof setInterval>;
  private static readonly POLLING_INTERVAL_MS = 5 * 60 * 1000; // 5 хвилин

  constructor() {
    this.dataManager = new DataManager();
    this.envManager = new EnvManager();

    // Create a placeholder monitor for API server (will be replaced if credentials exist)
    const placeholderMonitor = {
      isConnected: () => this.isTelegramConnected,
      connect: async () => { },
      disconnect: async () => { },
      getRecentMessages: async () => [],
      subscribeToNewMessages: () => { },
    } as any;

    this.apiServer = new ApiServer(this.dataManager, placeholderMonitor);
  }

  async initialize(): Promise<void> {
    logger.info('=== FiatLux Service Starting ===');

    try {
      // Initialize data storage
      await this.dataManager.initialize();

      // Check if Telegram credentials are configured
      const hasCredentials = this.envManager.hasRequiredCredentials();

      if (!hasCredentials) {
        logger.info('');
        logger.info('⚙️  Telegram credentials not configured');
        logger.info('🌐 Starting web interface for initial setup');
        logger.info(`📍 Open http://localhost:${config.server.port}/setup.html to configure`);
        logger.info('');

        // Start API server only
        this.apiServer.listen(config.server.port, config.server.host);
        logger.info('=== FiatLux Service Started (Setup Mode) ===');
        return;
      }

      // Credentials exist, try to connect to Telegram
      logger.info(`Monitoring channel: ${config.telegram.channelUsername}`);

      this.telegramMonitor = new TelegramChannelMonitor();

      // Update API server with real monitor
      (this.apiServer as any).telegramMonitor = this.telegramMonitor;

      // Start API server EARLY to ensure web interface is available
      this.apiServer.listen(config.server.port, config.server.host);
      logger.info('API server started, proceeding with Telegram connection...');

      // Connect to Telegram
      try {
        await this.telegramMonitor.connect();
        this.isTelegramConnected = true;
      } catch (error) {
        // Перевіряємо чи SESSION_STRING невалідний або авторизація втрачена
        const errorMsg = typeof error === 'object' && error && (error as any).message ? (error as any).message : String(error);

        if (
          errorMsg.includes('NOT_AUTHORIZED') ||
          errorMsg.includes('SESSION_STRING') ||
          !config.telegram.sessionString
        ) {
          logger.warn('❌ SESSION_STRING невалідний або авторизація відсутня/відкликана');
          logger.warn('Перемикаємося у режим налаштування (setup mode)');
          logger.info(`📍 Open http://localhost:${config.server.port}/setup.html to authenticate via WEB`);
          // API server is already listening
          logger.info('=== FiatLux Service Started (Setup Mode) ===');
          return;
        } else {
          logger.error('Telegram connection failed:', error);
          logger.info('=== FiatLux Service Started (Limited Mode) ===');
          return;
        }
      }

      // Load recent messages and parse them
      await this.loadRecentSchedules();

      // Subscribe to new messages
      this.subscribeToNewMessages();

      // Запуск періодичного опитування (підстраховка для event handler)
      this.startPolling();

      logger.info('=== FiatLux Service Started Successfully ===');
    } catch (error) {
      logger.error('Failed to initialize service:', error);
      throw error;
    }
  }

  private async loadRecentSchedules(): Promise<void> {
    if (!this.telegramMonitor) return;

    try {
      logger.info('Loading recent messages...');
      const messages = await this.telegramMonitor.getRecentMessages(100);
      const schedules = ScheduleParser.parseMessages(messages);

      logger.info(`Found ${schedules.length} schedules in recent messages`);

      for (const schedule of schedules) {
        await this.dataManager.saveSchedule(schedule);
      }

      logger.info('Recent schedules loaded successfully');
    } catch (error) {
      logger.error('Failed to load recent schedules:', error);
    }
  }

  private subscribeToNewMessages(): void {
    if (!this.telegramMonitor) return;

    this.telegramMonitor.subscribeToNewMessages(async (message: Api.Message) => {
      try {
        logger.info(`Processing new message: ${message.id}`);
        this.apiServer.updateLastMessageCheck();

        const schedule = ScheduleParser.parseMessage(message);

        if (schedule) {
          await this.dataManager.saveSchedule(schedule);
          logger.info(`New schedule saved: ${schedule.type} for ${schedule.date} (from message ${message.id})`);
        } else {
          logger.debug(`Message ${message.id} does not contain schedule information`);
        }
      } catch (error) {
        logger.error('Error processing new message:', error);
      }
    });
  }

  // Періодичне опитування каналу — підстраховка, якщо event handler не отримує оновлення
  private startPolling(): void {
    logger.info(`Polling every ${FiatLuxService.POLLING_INTERVAL_MS / 1000}s for new schedules`);

    this.pollingInterval = setInterval(async () => {
      if (this.isShuttingDown || !this.telegramMonitor) return;

      try {
        logger.debug('Polling for new messages...');
        const messages = await this.telegramMonitor.getRecentMessages(20);
        const schedules = ScheduleParser.parseMessages(messages);

        let newCount = 0;
        for (const schedule of schedules) {
          const isNew = await this.dataManager.saveSchedule(schedule);
          if (isNew) newCount++;
        }

        if (newCount > 0) {
          logger.info(`Polling: found ${newCount} new schedule(s)`);
          this.apiServer.updateLastMessageCheck();
        }
      } catch (error) {
        logger.error('Polling error:', error);
      }
    }, FiatLuxService.POLLING_INTERVAL_MS);
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    logger.info('=== Shutting down FiatLux Service ===');

    try {
      // Зупинити polling
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = undefined;
      }

      // Disconnect from Telegram if connected
      if (this.telegramMonitor && this.isTelegramConnected) {
        await this.telegramMonitor.disconnect();
      }

      logger.info('=== FiatLux Service Stopped ===');
      logger.info('ℹ️ In-memory data has been cleared (data will be reloaded on restart)');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Main entry point
async function main() {
  const service = new FiatLuxService();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Received SIGINT signal');
    service.shutdown();
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM signal');
    service.shutdown();
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
    service.shutdown();
  });

  process.on('unhandledRejection', (reason, _promise) => {
    // Логуємо але НЕ зупиняємо сервіс — GramJS може генерувати unhandled rejections
    const message = reason instanceof Error
      ? `${reason.message}\n${reason.stack}`
      : JSON.stringify(reason, null, 2);
    logger.error(`Unhandled rejection: ${message}`);
  });

  // Start the service
  try {
    await service.initialize();
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

// Run the service
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
