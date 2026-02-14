import { TelegramChannelMonitor } from './telegram/client';
import { ScheduleParser } from './parsers/scheduleParser';
import { DataManager } from './storage/dataManager';
import { ApiServer } from './api/server';
import config from './config';
import { logger } from './utils/logger';
import { Api } from 'telegram/tl';

class FiatLuxService {
  private telegramMonitor: TelegramChannelMonitor;
  private dataManager: DataManager;
  private apiServer: ApiServer;
  private isShuttingDown = false;

  constructor() {
    this.telegramMonitor = new TelegramChannelMonitor();
    this.dataManager = new DataManager();
    this.apiServer = new ApiServer(this.dataManager, this.telegramMonitor);
  }

  async initialize(): Promise<void> {
    logger.info('=== FiatLux Service Starting ===');
    logger.info(`Monitoring channel: ${config.telegram.channelUsername}`);
    
    if (!config.telegram.sessionString) {
      logger.info('');
      logger.info('📱 Перший запуск - потрібна авторизація в Telegram');
      logger.info('Після успішної авторизації збережіть SESSION_STRING у .env файл');
      logger.info('');
    }
    
    try {
      // Initialize data storage
      await this.dataManager.initialize();
      
      // Connect to Telegram
      await this.telegramMonitor.connect();
      
      // Load recent messages and parse them
      await this.loadRecentSchedules();
      
      // Subscribe to new messages
      this.subscribeToNewMessages();
      
      // Start API server
      this.apiServer.listen(config.server.port, config.server.host);
      
      logger.info('=== FiatLux Service Started Successfully ===');
    } catch (error) {
      logger.error('Failed to initialize service:', error);
      throw error;
    }
  }

  private async loadRecentSchedules(): Promise<void> {
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
    this.telegramMonitor.subscribeToNewMessages(async (message: Api.Message) => {
      try {
        logger.info(`Processing new message: ${message.id}`);
        this.apiServer.updateLastMessageCheck();
        
        const schedule = ScheduleParser.parseMessage(message);
        
        if (schedule) {
          await this.dataManager.saveSchedule(schedule);
          logger.info(`New schedule saved: ${schedule.type} for ${schedule.date}`);
        } else {
          logger.debug('Message does not contain schedule information');
        }
      } catch (error) {
        logger.error('Error processing new message:', error);
      }
    });
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    logger.info('=== Shutting down FiatLux Service ===');
    
    try {
      // Disconnect from Telegram
      await this.telegramMonitor.disconnect();
      
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
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', promise, 'reason:', reason);
    service.shutdown();
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
