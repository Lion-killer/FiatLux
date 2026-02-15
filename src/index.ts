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

  constructor() {
    this.dataManager = new DataManager();
    this.envManager = new EnvManager();
    
    // Create a placeholder monitor for API server (will be replaced if credentials exist)
    const placeholderMonitor = {
      isConnected: () => this.isTelegramConnected,
      connect: async () => {},
      disconnect: async () => {},
      getRecentMessages: async () => [],
      subscribeToNewMessages: () => {},
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
      
      // Connect to Telegram
      await this.telegramMonitor.connect();
      this.isTelegramConnected = true;
      
      // Load recent messages and parse them
      await this.loadRecentSchedules();
      
      // Subscribe to new messages
      this.subscribeToNewMessages();
      
      // Start API server
      this.apiServer.listen(config.server.port, config.server.host);
      
      logger.info('=== FiatLux Service Started Successfully ===');
    } catch (error) {
      logger.error('Failed to initialize service:', error);
      
      // If Telegram connection failed but we have API server, still run in limited mode
      if (!this.isTelegramConnected) {
        logger.warn('');
        logger.warn('⚠️  Telegram connection failed, but API server will continue running');
        logger.warn('🌐 You can reconfigure credentials at /setup.html');
        logger.warn('');
        
        try {
          this.apiServer.listen(config.server.port, config.server.host);
          logger.info('=== FiatLux Service Started (Limited Mode) ===');
        } catch (apiError) {
          logger.error('Failed to start API server:', apiError);
          throw apiError;
        }
      } else {
        throw error;
      }
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
