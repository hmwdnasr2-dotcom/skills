import type { BridgeAdapter } from '@aria/core';
import { sendReport, type ReportPeriod } from '../services/reportScheduler.js';

const PERIODS: ReportPeriod[] = ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

export function buildReportAdapters(): BridgeAdapter[] {
  return [
    {
      name: 'generate_report',
      description:
        'Generate and send a productivity report for a given period via Telegram and/or email. ' +
        'Call when user says "give me my daily report", "send weekly summary", ' +
        '"what did I achieve this month", "generate quarterly review", etc.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'string' },
          period: {
            type: 'string',
            enum: PERIODS,
            description: 'hourly | daily | weekly | monthly | quarterly | yearly',
          },
        },
        required: ['user_id', 'period'],
      },
      async call(input) {
        const { user_id, period } = input as { user_id: string; period: ReportPeriod };
        if (!PERIODS.includes(period)) throw new Error(`Invalid period: ${period}`);
        const report = await sendReport(user_id, period);
        const preview = report.slice(0, 120).replace(/\n/g, ' ');
        return `${period.charAt(0).toUpperCase() + period.slice(1)} report sent. Preview: ${preview}…`;
      },
    },
  ];
}
