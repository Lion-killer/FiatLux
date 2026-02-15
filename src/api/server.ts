import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { ApiResponse, HealthStatus } from '../types';
import { DataManager } from '../storage/dataManager';
import { TelegramChannelMonitor } from '../telegram/client';
import { ScheduleParser } from '../parsers/scheduleParser';
import { logger } from '../utils/logger';
import { EnvManager } from '../utils/envManager';
import { TelegramAuthManager } from '../telegram/authManager';

export class ApiServer {
  private app: express.Application;
  private dataManager: DataManager;
  private telegramMonitor: TelegramChannelMonitor;
  private envManager: EnvManager;
  private authManager: TelegramAuthManager;
  private startTime: number = Date.now();
  private lastMessageCheck?: string;

  constructor(dataManager: DataManager, telegramMonitor: TelegramChannelMonitor) {
    this.app = express();
    this.dataManager = dataManager;
    this.telegramMonitor = telegramMonitor;
    this.envManager = new EnvManager();
    this.authManager = new TelegramAuthManager();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
    
    // Clean up old auth sessions every 5 minutes
    setInterval(() => this.authManager.cleanupOldSessions(), 5 * 60 * 1000);
  }

  private setupMiddleware(): void {
    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, '..', '..', 'public')));

    // Parse JSON bodies
    this.app.use(express.json());

    // CORS
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', async (req: Request, res: Response) => {
      await this.handleHealthCheck(req, res);
    });

    // Get current schedule
    this.app.get('/api/schedule/current', async (req: Request, res: Response) => {
      await this.handleGetCurrent(req, res);
    });

    // Get future schedule
    this.app.get('/api/schedule/future', async (req: Request, res: Response) => {
      await this.handleGetFuture(req, res);
    });

    // Get all schedules
    this.app.get('/api/schedule/all', async (req: Request, res: Response) => {
      await this.handleGetAll(req, res);
    });

    // Get history
    this.app.get('/api/schedule/history', async (req: Request, res: Response) => {
      await this.handleGetHistory(req, res);
    });

    // Refresh schedules
    this.app.post('/api/refresh', async (req: Request, res: Response) => {
      await this.handleRefresh(req, res);
    });

    // Debug endpoint to check system date detection
    this.app.get('/api/debug/dates', (_req: Request, res: Response) => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = `${tomorrow.getFullYear()}-${(tomorrow.getMonth() + 1).toString().padStart(2, '0')}-${tomorrow.getDate().toString().padStart(2, '0')}`;
      
      res.json({
        systemDate: new Date().toISOString(),
        localTime: today.toString(),
        todayDetected: todayStr,
        tomorrowDetected: tomorrowStr,
      });
    });

    // Setup endpoints
    this.app.get('/api/setup/status', async (req: Request, res: Response) => {
      await this.handleSetupStatus(req, res);
    });

    this.app.post('/api/setup/credentials', async (req: Request, res: Response) => {
      await this.handleSaveCredentials(req, res);
    });

    this.app.post('/api/setup/auth/start', async (req: Request, res: Response) => {
      await this.handleAuthStart(req, res);
    });

    this.app.post('/api/setup/auth/code', async (req: Request, res: Response) => {
      await this.handleAuthCode(req, res);
    });

    this.app.post('/api/setup/auth/password', async (req: Request, res: Response) => {
      await this.handleAuthPassword(req, res);
    });

    // API info endpoint
    this.app.get('/api/info', (_req: Request, res: Response) => {
      res.json({
        name: 'FiatLux - Telegram Channel Monitor',
        version: '1.0.0',
        description: 'Monitoring Cherkasyoblenergo power outage schedules',
        endpoints: {
          health: '/api/health',
          current: '/api/schedule/current',
          future: '/api/schedule/future',
          all: '/api/schedule/all',
          history: '/api/schedule/history',
          refresh: '/api/refresh (POST)',
          debug: '/api/debug/dates',
          web: '/',
        },
      });
    });
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      const response: ApiResponse = {
        success: false,
        error: 'Endpoint not found',
        timestamp: new Date().toISOString(),
      };
      res.status(404).json(response);
    });

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      logger.error('API Error:', err);
      
      const response: ApiResponse = {
        success: false,
        error: err.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      };
      
      res.status(500).json(response);
    });
  }

  private async handleHealthCheck(_req: Request, res: Response): Promise<void> {
    try {
      const schedulesCount = await this.dataManager.getCount();
      
      const health: HealthStatus = {
        status: 'ok',
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        telegramConnected: this.telegramMonitor.isConnected(),
        lastMessageCheck: this.lastMessageCheck,
        schedulesCount,
      };
      
      const response: ApiResponse<HealthStatus> = {
        success: true,
        data: health,
        timestamp: new Date().toISOString(),
      };
      
      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleGetCurrent(_req: Request, res: Response): Promise<void> {
    try {
      const schedule = await this.dataManager.getCurrentSchedule();
      
      const response: ApiResponse = {
        success: true,
        data: schedule,
        timestamp: new Date().toISOString(),
      };
      
      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleGetFuture(_req: Request, res: Response): Promise<void> {
    try {
      const schedule = await this.dataManager.getFutureSchedule();
      
      const response: ApiResponse = {
        success: true,
        data: schedule,
        timestamp: new Date().toISOString(),
      };
      
      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleGetAll(_req: Request, res: Response): Promise<void> {
    try {
      const schedules = await this.dataManager.getAllSchedules();
      
      const response: ApiResponse = {
        success: true,
        data: schedules,
        timestamp: new Date().toISOString(),
      };
      
      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleGetHistory(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const history = await this.dataManager.getHistory(limit);
      
      const response: ApiResponse = {
        success: true,
        data: history,
        timestamp: new Date().toISOString(),
      };
      
      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleRefresh(_req: Request, res: Response): Promise<void> {
    try {
      logger.info('Manual refresh requested');
      this.lastMessageCheck = new Date().toISOString();
      
      const messages = await this.telegramMonitor.getRecentMessages(50);
      const schedules = ScheduleParser.parseMessages(messages);
      
      for (const schedule of schedules) {
        await this.dataManager.saveSchedule(schedule);
      }
      
      const response: ApiResponse = {
        success: true,
        data: {
          messagesChecked: messages.length,
          schedulesParsed: schedules.length,
        },
        timestamp: new Date().toISOString(),
      };
      
      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Refresh error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleSetupStatus(_req: Request, res: Response): Promise<void> {
    try {
      const hasApiCredentials = this.envManager.hasApiCredentials();
      const hasSession = !!this.envManager.getVariable('SESSION_STRING');
      const isConfigured = this.envManager.hasRequiredCredentials();

      const response: ApiResponse = {
        success: true,
        data: {
          configured: isConfigured,
          hasApiCredentials,
          hasSession,
          apiId: hasApiCredentials ? this.envManager.getVariable('API_ID') : undefined,
        },
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleSaveCredentials(req: Request, res: Response): Promise<void> {
    try {
      const { apiId, apiHash } = req.body;

      if (!apiId || !apiHash) {
        res.status(400).json({
          success: false,
          error: 'API_ID and API_HASH are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Validate API_ID is a number
      const apiIdNum = parseInt(apiId, 10);
      if (isNaN(apiIdNum)) {
        res.status(400).json({
          success: false,
          error: 'API_ID must be a number',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Save to .env
      this.envManager.updateVariables({
        API_ID: apiId,
        API_HASH: apiHash,
      });

      logger.info('Telegram API credentials saved');

      const response: ApiResponse = {
        success: true,
        data: { message: 'Credentials saved successfully' },
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Save credentials error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleAuthStart(req: Request, res: Response): Promise<void> {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        res.status(400).json({
          success: false,
          error: 'Phone number is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const apiId = parseInt(this.envManager.getVariable('API_ID') || '', 10);
      const apiHash = this.envManager.getVariable('API_HASH') || '';

      if (!apiId || !apiHash) {
        res.status(400).json({
          success: false,
          error: 'API credentials not configured',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const result = await this.authManager.startAuth(apiId, apiHash, phoneNumber);

      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Auth start error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleAuthCode(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, code } = req.body;

      if (!sessionId || !code) {
        res.status(400).json({
          success: false,
          error: 'Session ID and code are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const result = await this.authManager.submitCode(sessionId, code);

      if (result.success && result.sessionString) {
        // Save session string to .env
        this.envManager.updateVariables({
          SESSION_STRING: result.sessionString,
        });
        logger.info('Session string saved successfully');
      }

      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Auth code error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleAuthPassword(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, password } = req.body;

      if (!sessionId || !password) {
        res.status(400).json({
          success: false,
          error: 'Session ID and password are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const result = await this.authManager.submitPassword(sessionId, password);

      if (result.success && result.sessionString) {
        // Save session string to .env
        this.envManager.updateVariables({
          SESSION_STRING: result.sessionString,
        });
        logger.info('Session string saved successfully (with 2FA)');
      }

      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Auth password error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  updateLastMessageCheck(): void {
    this.lastMessageCheck = new Date().toISOString();
  }

  listen(port: number, host: string): void {
    this.app.listen(port, host, () => {
      logger.info(`API server listening on http://${host}:${port}`);
    });
  }

  getApp(): express.Application {
    return this.app;
  }
}
