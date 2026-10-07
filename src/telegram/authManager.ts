import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { computeCheck } from 'telegram/Password';
import { logger } from '../utils/logger';

/** Куди Telegram надіслав код входу — показується користувачу на setup.html */
function describeCodeDelivery(type: Api.auth.TypeSentCodeType): string {
  if (type instanceof Api.auth.SentCodeTypeApp) return 'у застосунок Telegram — чат «Telegram» на іншому вашому пристрої';
  if (type instanceof Api.auth.SentCodeTypeSms || type instanceof Api.auth.SentCodeTypeFirebaseSms) return 'SMS-повідомленням';
  if (type instanceof Api.auth.SentCodeTypeEmailCode) return `на email ${type.emailPattern}`;
  if (type instanceof Api.auth.SentCodeTypeFragmentSms) return `через Fragment: ${type.url}`;
  if (type instanceof Api.auth.SentCodeTypeSetUpEmailRequired) return 'нікуди: Telegram вимагає спершу прив\'язати email для входу (Налаштування → Конфіденційність → Email для входу)';
  return `дзвінком (${type.className})`;
}

interface AuthSession {
  client: TelegramClient;
  phoneNumber: string;
  phoneCodeHash?: string;
  status: 'awaiting_code' | 'awaiting_password' | 'completed' | 'failed';
}

export class TelegramAuthManager {
  private activeSessions: Map<string, AuthSession> = new Map();

  /**
   * Start authentication process with phone number
   */
  async startAuth(apiId: number, apiHash: string, phoneNumber: string): Promise<{ sessionId: string; codeLength?: number; deliveredTo: string }> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      const session = new StringSession('');
      const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
      });

      await client.connect();

      // Request phone code (напряму, щоб знати, куди Telegram його надіслав)
      const result = await client.invoke(new Api.auth.SendCode({
        phoneNumber,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      }));
      if (result instanceof Api.auth.SentCodeSuccess) throw new Error('Telegram authorized without a code');

      this.activeSessions.set(sessionId, {
        client,
        phoneNumber,
        phoneCodeHash: result.phoneCodeHash,
        status: 'awaiting_code',
      });

      const deliveredTo = describeCodeDelivery(result.type);
      logger.info(`Auth started for session ${sessionId}, code via ${result.type.className}`);

      return {
        sessionId,
        codeLength: 'length' in result.type ? result.type.length : undefined,
        deliveredTo,
      };
    } catch (error) {
      logger.error('Failed to start auth:', error);
      throw new Error(`Failed to send verification code: ${error}`);
    }
  }

  /**
   * Complete authentication with verification code
   */
  async submitCode(sessionId: string, code: string): Promise<{ success: boolean; needsPassword?: boolean; sessionString?: string }> {
    const session = this.activeSessions.get(sessionId);
    
    if (!session) {
      throw new Error('Invalid or expired session');
    }

    try {
      await session.client.invoke(
        new (require('telegram/tl').Api.auth.SignIn)({
          phoneNumber: session.phoneNumber,
          phoneCodeHash: session.phoneCodeHash,
          phoneCode: code,
        })
      );

      // Successfully authenticated
      const sessionString = session.client.session.save() as unknown as string;
      
      session.status = 'completed';
      this.activeSessions.delete(sessionId);

      logger.info(`Auth completed for session ${sessionId}`);

      return {
        success: true,
        sessionString,
      };
    } catch (error: any) {
      // Check if 2FA password is required
      if (error.message && error.message.includes('SESSION_PASSWORD_NEEDED')) {
        session.status = 'awaiting_password';
        logger.info(`2FA password required for session ${sessionId}`);
        
        return {
          success: false,
          needsPassword: true,
        };
      }

      // Other error
      session.status = 'failed';
      this.activeSessions.delete(sessionId);
      
      logger.error('Failed to submit code:', error);
      throw new Error(`Invalid verification code: ${error.message}`);
    }
  }

  /**
   * Complete authentication with 2FA password
   */
  async submitPassword(sessionId: string, password: string): Promise<{ success: boolean; sessionString: string }> {
    const session = this.activeSessions.get(sessionId);
    
    if (!session || session.status !== 'awaiting_password') {
      throw new Error('Invalid session or password not required');
    }

    try {
      // Get password info
      const passwordInfo = await session.client.invoke(
        new (require('telegram/tl').Api.account.GetPassword)()
      );

      // Compute password hash
      const passwordHash = await computeCheck(passwordInfo, password);

      await session.client.invoke(
        new (require('telegram/tl').Api.auth.CheckPassword)({
          password: passwordHash,
        })
      );

      // Successfully authenticated
      const sessionString = session.client.session.save() as unknown as string;
      
      session.status = 'completed';
      this.activeSessions.delete(sessionId);

      logger.info(`Auth with 2FA completed for session ${sessionId}`);

      return {
        success: true,
        sessionString,
      };
    } catch (error: any) {
      session.status = 'failed';
      this.activeSessions.delete(sessionId);
      
      logger.error('Failed to submit password:', error);
      throw new Error(`Invalid password: ${error.message}`);
    }
  }

  /**
   * Cancel authentication session
   */
  cancelAuth(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    
    if (session) {
      session.client.disconnect();
      this.activeSessions.delete(sessionId);
      logger.info(`Auth cancelled for session ${sessionId}`);
    }
  }

  /**
   * Clean up old sessions (older than 10 minutes)
   */
  cleanupOldSessions(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    for (const [sessionId, session] of this.activeSessions.entries()) {
      const sessionTime = parseInt(sessionId.split('_')[1]);
      
      if (now - sessionTime > maxAge) {
        session.client.disconnect();
        this.activeSessions.delete(sessionId);
        logger.info(`Cleaned up expired session ${sessionId}`);
      }
    }
  }
}
