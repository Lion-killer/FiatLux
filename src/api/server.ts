import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { ApiResponse, HealthStatus } from '../types';
import { DataManager } from '../storage/dataManager';
import { TelegramChannelMonitor } from '../telegram/client';
import { ScheduleParser } from '../parsers/scheduleParser';
import { logger } from '../utils/logger';
import { EnvManager } from '../utils/envManager';
import { TelegramAuthManager } from '../telegram/authManager';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

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
    // Swagger Documentation
    const swaggerOptions = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'FiatLux API',
          version: '1.0.0',
          description: 'API for monitoring Cherkasyoblenergo power outage schedules',
        },
      },
      apis: [__filename],
    };

    const swaggerDocs = swaggerJsdoc(swaggerOptions);
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

    // Redirect /docs to /api-docs for convenience
    this.app.get('/docs', (_req, res) => res.redirect('/api-docs'));

    /**
     * @openapi
     * /api/health:
     *   get:
     *     summary: Get service health status
     *     tags: [System]
     *     responses:
     *       200:
     *         description: Service health information
     */
    // Health check
    this.app.get('/api/health', async (req: Request, res: Response) => {
      await this.handleHealthCheck(req, res);
    });

    /**
     * @openapi
     * /api/schedule/current:
     *   get:
     *     summary: Get currently active schedule
     *     tags: [Schedules]
     *     responses:
     *       200:
     *         description: Current schedule data
     */
    // Get current schedule
    this.app.get('/api/schedule/current', async (req: Request, res: Response) => {
      await this.handleGetCurrent(req, res);
    });

    /**
     * @openapi
     * /api/schedule/future:
     *   get:
     *     summary: Get future (upcoming) schedule
     *     tags: [Schedules]
     *     responses:
     *       200:
     *         description: Future schedule data
     */
    // Get future schedule
    this.app.get('/api/schedule/future', async (req: Request, res: Response) => {
      await this.handleGetFuture(req, res);
    });

    /**
     * @openapi
     * /api/schedule/all:
     *   get:
     *     summary: Get all available schedules
     *     tags: [Schedules]
     *     responses:
     *       200:
     *         description: List of all schedules
     */
    // Get all schedules
    this.app.get('/api/schedule/all', async (req: Request, res: Response) => {
      await this.handleGetAll(req, res);
    });

    /**
     * @openapi
     * /api/schedule/history:
     *   get:
     *     summary: Get history of parsed messages (today and tomorrow)
     *     tags: [History]
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 10
     *         description: Number of records to return
     *     responses:
     *       200:
     *         description: History of messages
     */
    // Get history (relevant only)
    this.app.get('/api/schedule/history', async (req: Request, res: Response) => {
      await this.handleGetHistory(req, res);
    });

    /**
     * @openapi
     * /api/schedule/messages:
     *   get:
     *     summary: Get all parsed schedule messages (raw history)
     *     tags: [History]
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Number of records to return
     *     responses:
     *       200:
     *         description: List of parsed messages
     */
    // Get all messages
    this.app.get('/api/schedule/messages', async (req: Request, res: Response) => {
      await this.handleGetMessages(req, res);
    });

    /**
     * @openapi
     * /api/refresh:
     *   post:
     *     summary: Force manual refresh/parsing of Telegram messages
     *     tags: [System]
     *     responses:
     *       200:
     *         description: Refresh results
     */
    // Refresh schedules
    this.app.post('/api/refresh', async (req: Request, res: Response) => {
      await this.handleRefresh(req, res);
    });

    /**
     * @openapi
     * /api/debug/dates:
     *   get:
     *     summary: Debug endpoint for system date detection
     *     tags: [Debug]
     *     responses:
     *       200:
     *         description: System date and time info
     */
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

    /**
     * @openapi
     * /api/setup/status:
     *   get:
     *     summary: Get setup and configuration status
     *     tags: [Setup]
     *     responses:
     *       200:
     *         description: Configuration status
     */
    // Setup endpoints
    this.app.get('/api/setup/status', async (req: Request, res: Response) => {
      await this.handleSetupStatus(req, res);
    });

    /**
     * @openapi
     * /api/setup/credentials:
     *   post:
     *     summary: Save Telegram API credentials
     *     tags: [Setup]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               apiId:
     *                 type: string
     *               apiHash:
     *                 type: string
     *     responses:
     *       200:
     *         description: Credentials saved successfully
     */
    this.app.post('/api/setup/credentials', async (req: Request, res: Response) => {
      await this.handleSaveCredentials(req, res);
    });

    /**
     * @openapi
     * /api/setup/auth/start:
     *   post:
     *     summary: Start Telegram authentication process
     *     tags: [Setup]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               phoneNumber:
     *                 type: string
     *     responses:
     *       200:
     *         description: Auth process started
     */
    this.app.post('/api/setup/auth/start', async (req: Request, res: Response) => {
      await this.handleAuthStart(req, res);
    });

    /**
     * @openapi
     * /api/setup/auth/code:
     *   post:
     *     summary: Submit Telegram verification code
     *     tags: [Setup]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               sessionId:
     *                 type: string
     *               code:
     *                 type: string
     *     responses:
     *       200:
     *         description: Code submitted
     */
    this.app.post('/api/setup/auth/code', async (req: Request, res: Response) => {
      await this.handleAuthCode(req, res);
    });

    /**
     * @openapi
     * /api/setup/auth/password:
     *   post:
     *     summary: Submit Telegram 2FA password
     *     tags: [Setup]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               sessionId:
     *                 type: string
     *               password:
     *                 type: string
     *     responses:
     *       200:
     *         description: Password submitted
     */
    this.app.post('/api/setup/auth/password', async (req: Request, res: Response) => {
      await this.handleAuthPassword(req, res);
    });

    /**
     * @openapi
     * /api/setup/restart:
     *   post:
     *     summary: Restart service after setup completion
     *     tags: [Setup]
     *     responses:
     *       200:
     *         description: Service restarting
     */
    // Перезапуск сервісу після завершення setup (Docker перезапустить контейнер)
    this.app.post('/api/setup/restart', (_req: Request, res: Response) => {
      logger.info('Restart requested after setup completion');
      res.json({
        success: true,
        data: { message: 'Service restarting...' },
        timestamp: new Date().toISOString(),
      });
      // Даємо час відправити відповідь, потім завершуємо процес
      setTimeout(() => {
        logger.info('Restarting service to apply new credentials...');
        process.exit(0);
      }, 2000);
    });

    /**
     * @openapi
     * /api/info:
     *   get:
     *     summary: Get API information and available endpoints
     *     tags: [System]
     *     responses:
     *       200:
     *         description: API meta-information
     */
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
          messages: '/api/schedule/messages',
          refresh: '/api/refresh (POST)',
          debug: '/api/debug/dates',
          setup: '/api/setup/*',
          docs: '/api-docs',
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
        lastParsedPublishedAt: await this.getLastParsedDate(),
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

  private async handleGetMessages(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const history = await this.dataManager.getRawHistory(limit);

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
        data: { ...result, restartRequired: !!(result.success && result.sessionString) },
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
        data: { ...result, restartRequired: !!(result.success && result.sessionString) },
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

  private async getLastParsedDate(): Promise<string | undefined> {
    try {
      const history = await this.dataManager.getHistory(1);
      return history.length > 0 ? history[0].publishedAt : undefined;
    } catch (error) {
      logger.error('Error getting last parsed date:', error);
      return undefined;
    }
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
