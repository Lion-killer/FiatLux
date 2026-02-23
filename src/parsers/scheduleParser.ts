import { Api } from 'telegram/tl';
import { Schedule, QueueInfo, TimeSlot } from '../types';
import { logger } from '../utils/logger';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getLocalDateString(date: Date): string {
  const year  = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day   = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  'січня': 1,  'січень': 1,
  'лютого': 2, 'лютий': 2,
  'березня': 3, 'березень': 3,
  'квітня': 4,  'квітень': 4,
  'травня': 5,  'травень': 5,
  'червня': 6,  'червень': 6,
  'липня': 7,   'липень': 7,
  'серпня': 8,  'серпень': 8,
  'вересня': 9, 'вересень': 9,
  'жовтня': 10, 'жовтень': 10,
  'листопада': 11, 'листопад': 11,
  'грудня': 12, 'грудень': 12,
};

const DATE_MARKERS = ['на', 'графік на', 'станом на'] as const;

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parser for power outage schedule messages from Cherkasyoblenergo channel.
 */
export class ScheduleParser {
  private static readonly KEYWORDS = [
    'графік',
    'графік відключень',
    'черга',
    'група',
    'відключення',
    'вимкнення',
    'знеструмлення',
  ];

  // ── Public API ─────────────────────────────────────────────────────────────

  static isScheduleMessage(text: string): boolean {
    const lower = text.toLowerCase();
    return this.KEYWORDS.some(kw => lower.includes(kw));
  }

  static determineScheduleType(_text: string, date: Date): 'current' | 'future' {
    const today    = startOfDay(new Date());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const scheduleDay = startOfDay(date);

    if (scheduleDay.getTime() === today.getTime())    return 'current';
    if (scheduleDay.getTime() === tomorrow.getTime()) return 'future';

    return 'current';
  }

  static isRelevantDate(date: Date): boolean {
    const today           = startOfDay(new Date());
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

    const scheduleDay = startOfDay(date);
    return scheduleDay >= today && scheduleDay < dayAfterTomorrow;
  }

  static extractDate(text: string): string | null {
    const today = new Date();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // 1. Шукаємо дату у рядках перед маркером "Години відсутності електропостачання"
    const markerIndex = lines.findIndex(l =>
      l.toLowerCase().includes('години відсутності електропостачання')
    );
    if (markerIndex > 0) {
      const result = this.findDateInLines(lines.slice(Math.max(0, markerIndex - 3), markerIndex), today);
      if (result) return result;
    }

    // 2. Шукаємо в перших трьох рядках за допомогою контекстних маркерів
    const result = this.findDateWithMarkersInLines(lines.slice(0, 3), today);
    if (result) return result;

    // 3. Шукаємо у відфільтрованому тексті (без блоків про оновлення)
    const filteredText = text.replace(
      /(?:наступне оновлення|оновлено о|оновлення)\s+[^]*$/gi,
      '',
    );

    const ukrainianDate = this.findUkrainianDate(filteredText, today);
    if (ukrainianDate) return ukrainianDate;

    const numericDate = this.findNumericDate(filteredText, today);
    if (numericDate) return numericDate;

    // 4. Відносні дати
    const lower = text.toLowerCase();
    if (lower.includes('сьогодні')) return getLocalDateString(today);
    if (lower.includes('завтра')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return getLocalDateString(tomorrow);
    }

    return getLocalDateString(today);
  }

  static extractTimeSlotsFromLine(text: string): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const pattern = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g;

    for (const match of text.matchAll(pattern)) {
      slots.push({
        start: `${match[1].padStart(2, '0')}:${match[2]}`,
        end:   `${match[3].padStart(2, '0')}:${match[4]}`,
      });
    }

    return slots;
  }

  static extractQueuesWithSubQueues(text: string): QueueInfo[] {
    const queuesMap = new Map<string, TimeSlot[]>();

    // Pattern: "1.1: 00:00 – 02:00, 07:00 – 09:30"
    for (const match of text.matchAll(/(\d+)\.(\d+):\s*([^\n]+)/g)) {
      const key       = `${match[1]}.${match[2]}`;
      const timeSlots = this.extractTimeSlotsFromLine(match[3]);
      if (timeSlots.length > 0) queuesMap.set(key, timeSlots);
    }

    return Array.from(queuesMap, ([key, timeSlots]) => {
      const [main, sub] = key.split('.').map(Number);
      return {
        queueNumber: main + sub / 10,
        timeSlots,
        description: `Черга ${key}`,
      };
    }).sort((a, b) => a.queueNumber - b.queueNumber);
  }

  /** @deprecated Use extractQueuesWithSubQueues */
  static extractQueues(text: string): number[] {
    const queues = new Set<number>();

    for (const match of text.matchAll(/(\d+)\.\d+:/g)) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 6) queues.add(n);
    }

    for (const match of text.matchAll(
      /(?:черг[аи]|груп[аи])\s*[№#]?\s*(\d+)|(\d+)\s*(?:черг[аи]|груп[аи])/gi,
    )) {
      const n = parseInt(match[1] ?? match[2], 10);
      if (n >= 1 && n <= 6) queues.add(n);
    }

    for (const match of text.matchAll(/(\d+)-[аяі]/g)) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 6) queues.add(n);
    }

    return Array.from(queues).sort((a, b) => a - b);
  }

  /** @deprecated Use extractQueuesWithSubQueues */
  static extractTimeSlots(text: string): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const pattern = /(?:з\s+)?(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})|(?:з\s+)?(\d{1,2}):(\d{2})\s+до\s+(\d{1,2}):(\d{2})/gi;

    for (const match of text.matchAll(pattern)) {
      const [sh, sm, eh, em] = match[1]
        ? [match[1], match[2], match[3], match[4]]
        : [match[5], match[6], match[7], match[8]];

      slots.push({
        start: `${sh.padStart(2, '0')}:${sm}`,
        end:   `${eh.padStart(2, '0')}:${em}`,
      });
    }

    return slots;
  }

  static parseMessage(message: Api.Message, strict = true): Schedule | null {
    const text = message.message;
    if (!text || !this.isScheduleMessage(text)) return null;

    try {
      const date = this.extractDate(text);
      if (!date) {
        logger.warn(`Could not extract date from message ID ${message.id}. Text starts with: "${text.substring(0, 50)}..."`);
        return null;
      }

      let queues = this.extractQueuesWithSubQueues(text);

      if (queues.length === 0) {
        const timeSlots = this.extractTimeSlots(text);
        queues = this.extractQueues(text).map(queueNumber => ({
          queueNumber,
          timeSlots,
          description: `Черга ${queueNumber}`,
        }));
      }

      if (queues.length === 0) {
        logger.debug(`Skipping message ID ${message.id} - no queues found in text`);
        return null;
      }

      if (!queues.some(q => q.timeSlots?.length > 0)) {
        logger.debug(`Skipping message ID ${message.id} - no time slots found in any of the ${queues.length} queues`);
        return null;
      }

      const scheduleDate = new Date(date);
      if (strict && !this.isRelevantDate(scheduleDate)) {
        logger.debug(`Skipping schedule for ${date} - not today or tomorrow (strict mode)`);
        return null;
      }

      const type = this.determineScheduleType(text, scheduleDate);

      const schedule: Schedule = {
        id:          `${message.id}-${date}`,
        type,
        date,
        queues,
        rawText:     text,
        publishedAt: new Date(message.date * 1000).toISOString(),
        messageId:   message.id,
        channelId:   message.chatId?.toString() ?? '',
        archived:    false,
      };

      logger.info(`Parsed schedule: ${type} for ${date} with ${queues.length} queues`);
      return schedule;
    } catch (error) {
      logger.error('Error parsing message:', error);
      return null;
    }
  }

  static parseMessages(messages: Api.Message[], strict = true): Schedule[] {
    return messages.reduce<Schedule[]>((acc, msg) => {
      const schedule = this.parseMessage(msg, strict);
      if (schedule) acc.push(schedule);
      return acc;
    }, []);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private static buildDateString(day: string, monthNum: number, year: number): string {
    return `${year}-${monthNum.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  /** Шукає українську дату (DD місяць) у довільному наборі рядків. */
  private static findDateInLines(lines: string[], ref: Date): string | null {
    for (const line of lines) {
      const result = this.findUkrainianDate(line, ref);
      if (result) return result;
    }
    return null;
  }

  /** Шукає дату з контекстним маркером ("на", "графік на", …) у рядках. */
  private static findDateWithMarkersInLines(lines: string[], ref: Date): string | null {
    for (const line of lines) {
      const lower = line.toLowerCase();

      for (const marker of DATE_MARKERS) {
        for (const [name, num] of Object.entries(MONTHS)) {
          const match = lower.match(new RegExp(`${marker}\\s+(\\d{1,2})\\s+${name}`, 'i'));
          if (match) return this.buildDateString(match[1], num, ref.getFullYear());
        }

        const numMatch = lower.match(
          new RegExp(`${marker}\\s+(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}))?`, 'i'),
        );
        if (numMatch) {
          return this.buildDateString(
            numMatch[1],
            parseInt(numMatch[2], 10),
            numMatch[3] ? parseInt(numMatch[3], 10) : ref.getFullYear(),
          );
        }
      }
    }

    return null;
  }

  /** Шукає першу українську дату виду "DD місяць" у тексті. */
  private static findUkrainianDate(text: string, ref: Date): string | null {
    const lower = text.toLowerCase();
    for (const [name, num] of Object.entries(MONTHS)) {
      const match = lower.match(new RegExp(`(\\d{1,2})\\s+${name}`, 'i'));
      if (match) return this.buildDateString(match[1], num, ref.getFullYear());
    }
    return null;
  }

  /** Шукає першу числову дату виду DD.MM[.YYYY] у тексті. */
  private static findNumericDate(text: string, ref: Date): string | null {
    const match = text.match(/(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/);
    if (!match) return null;
    return this.buildDateString(
      match[1],
      parseInt(match[2], 10),
      match[3] ? parseInt(match[3], 10) : ref.getFullYear(),
    );
  }
}
