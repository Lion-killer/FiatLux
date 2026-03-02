import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram/tl';
import type { ITelegramMonitor } from '../types';
import config from '../config';
import { logger } from '../utils/logger';

export class TelegramChannelMonitor implements ITelegramMonitor {
  private static readonly GET_MESSAGES_TIMEOUT_MS = 15_000;

  private client: TelegramClient;
  private connected: boolean = false;
  private session: StringSession;
  private messageHandler?: (message: Api.Message) => void;
  private reconnectInProgress: boolean = false;
  private lastFetchAt?: string;
  private lastFetchSuccessAt?: string;
  private lastFetchError?: string;

  constructor() {
    this.session = new StringSession(config.telegram.sessionString);
    this.client = new TelegramClient(
      this.session,
      config.telegram.apiId,
      config.telegram.apiHash,
      {
        connectionRetries: 5,
      }
    );
  }

  async connect(): Promise<void> {
    try {
      logger.info('Connecting to Telegram...');

      await this.client.connect();

      if (!await this.client.isUserAuthorized()) {
        logger.warn('Telegram client is connected but NOT authorized.');
        this.connected = false;
        throw new Error('NOT_AUTHORIZED');
      }

      this.connected = true;
      logger.info('Successfully connected to Telegram');

      // Save session string for future use
      const sessionString = this.client.session.save() as unknown as string;
      if (sessionString && !config.telegram.sessionString) {
        logger.info('');
        logger.info('='.repeat(80));
        logger.info('✅ ВАЖЛИВО! Авторизація успішна!');
        logger.info('');
        logger.info('Щоб не вводити номер телефону та код при кожному запуску,');
        logger.info('додайте цей рядок у ваш .env файл:');
        logger.info('');
        logger.info(`SESSION_STRING=${sessionString}`);
        logger.info('');
        logger.info('Після збереження Session String авторизація буде автоматичною.');
        logger.info('='.repeat(80));
        logger.info('');
      }
    } catch (error) {
      logger.error('Failed to connect to Telegram:', error);
      throw error;
    }
  }

  async getRecentMessages(limit: number = 50): Promise<Api.Message[]> {
    if (!this.connected) {
      throw new Error('Telegram client is not connected');
    }

    try {
      this.lastFetchAt = new Date().toISOString();
      logger.info(`Fetching ${limit} recent messages from ${config.telegram.channelUsername}...`);

      const messages = await this.withTimeout(
        this.client.getMessages(config.telegram.channelUsername, {
          limit,
        }),
        TelegramChannelMonitor.GET_MESSAGES_TIMEOUT_MS,
        `Telegram getMessages timeout after ${TelegramChannelMonitor.GET_MESSAGES_TIMEOUT_MS}ms`
      );

      logger.info(`Retrieved ${messages.length} messages`);
      this.lastFetchSuccessAt = new Date().toISOString();
      this.lastFetchError = undefined;
      return messages.filter((msg: any): msg is Api.Message => msg instanceof Api.Message);
    } catch (error) {
      this.lastFetchError = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch messages:', error);

      // Якщо Telegram "підвис", пробуємо перепідключитися для наступних циклів
      await this.reconnectAfterFailure(error);

      throw error;
    }
  }

  private async reconnectAfterFailure(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);

    if (this.reconnectInProgress) {
      logger.warn('Reconnect already in progress, skipping duplicate reconnect attempt');
      return;
    }

    this.reconnectInProgress = true;

    try {
      logger.warn(`Attempting Telegram reconnect after fetch failure: ${message}`);

      try {
        await this.client.disconnect();
      } catch {
        // ignore disconnect errors
      }

      await this.client.connect();
      this.connected = await this.client.isUserAuthorized();

      if (this.connected) {
        logger.info('Telegram reconnect successful');
      } else {
        logger.warn('Telegram reconnect finished but client is not authorized');
      }
    } catch (reconnectError) {
      logger.error('Telegram reconnect failed:', reconnectError);
      this.connected = false;
    } finally {
      this.reconnectInProgress = false;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(errorMessage));
        }, timeoutMs);
      });

      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  subscribeToNewMessages(handler: (message: Api.Message) => void): void {
    if (!this.connected) {
      throw new Error('Telegram client is not connected');
    }

    this.messageHandler = handler;

    // Resolve entity спочатку для надійної фільтрації
    this.client.getInputEntity(config.telegram.channelUsername)
      .then(() => {
        this.client.addEventHandler(
          async (event: NewMessageEvent) => {
            const message = event.message;

            if (message instanceof Api.Message) {
              const preview = message.message ? message.message.substring(0, 100).replace(/\n/g, ' ') : '(no text)';
              logger.info(`New message received from event handler: ID ${message.id}. Text preview: "${preview}..."`);

              if (this.messageHandler) {
                this.messageHandler(message);
              }
            }
          },
          new NewMessage({ chats: [config.telegram.channelUsername] })
        );
        logger.info(`Subscribed to new messages from ${config.telegram.channelUsername} (resolved entity)`);
      })
      .catch((err) => {
        // Fallback — підписка без фільтра по чату, фільтруємо вручну
        logger.warn(`Could not resolve channel entity, subscribing without chat filter: ${err.message}`);
        this.client.addEventHandler(
          async (event: NewMessageEvent) => {
            const message = event.message;

            if (message instanceof Api.Message) {
              const preview = message.message ? message.message.substring(0, 100).replace(/\n/g, ' ') : '(no text)';
              logger.info(`New message received: ID ${message.id} from chat ${message.chatId}. Text preview: "${preview}..."`);

              if (this.messageHandler) {
                this.messageHandler(message);
              }
            }
          },
          new NewMessage({})
        );
        logger.info('Subscribed to all new messages (fallback mode)');
      });
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.disconnect();
      this.connected = false;
      logger.info('Disconnected from Telegram');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getHealth(): { lastFetchAt?: string; lastFetchSuccessAt?: string; lastFetchError?: string } {
    return {
      lastFetchAt: this.lastFetchAt,
      lastFetchSuccessAt: this.lastFetchSuccessAt,
      lastFetchError: this.lastFetchError,
    };
  }

  getClient(): TelegramClient {
    return this.client;
  }
}
