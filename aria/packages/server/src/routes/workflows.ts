import { Router } from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDynamicWorkflow, unregisterDynamicWorkflow } from '../proactive/scheduler.js';
import { claw } from '../core/index.js';

export const workflowsRouter = Router();

const STORE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.workflows.json');

export interface WorkflowRecord {
  id:         string;
  name:       string;
  description: string;
  icon:       string;
  cronExpr:   string;
  prompt:     string;
  userId:     string;
  enabled:    boolean;
  createdAt:  string;
  fromTemplate?: string;
}

export function loadWorkflows(): WorkflowRecord[] {
  try { return JSON.parse(readFileSync(STORE, 'utf8')); }
  catch { return []; }
}

function saveWorkflows(list: WorkflowRecord[]): void {
  writeFileSync(STORE, JSON.stringify(list, null, 2));
}

// ── Template library ──────────────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES = [
  {
    id: 'morning-briefing',
    name: 'Morning Briefing',
    description: 'Daily summary of tasks, reminders, and emails at 7:00 AM',
    icon: 'wb_sunny',
    category: 'daily',
    cronExpr: '0 7 * * *',
    prompt: 'Deliver my morning briefing: list overdue tasks, top 3 tasks for today, any unread important emails, and one sharp recommendation.',
  },
  {
    id: 'evening-recap',
    name: 'Evening Recap',
    description: 'Log achievements and set tomorrow\'s priorities at 8:00 PM',
    icon: 'nights_stay',
    category: 'daily',
    cronExpr: '0 20 * * *',
    prompt: 'Evening recap: what tasks were completed today, what\'s still open, and what should be the top priority tomorrow? Keep it under 100 words.',
  },
  {
    id: 'daily-focus',
    name: 'Daily Focus',
    description: 'Top 3 priorities for the day, weekdays at 9:00 AM',
    icon: 'center_focus_strong',
    category: 'daily',
    cronExpr: '0 9 * * 1-5',
    prompt: 'What are my top 3 most important tasks right now? Call list_tasks, pick the 3 highest-impact ones, and give me one sentence on why each matters. Be direct.',
  },
  {
    id: 'overdue-alert',
    name: 'Overdue Task Alert',
    description: 'Check for overdue tasks every 2 hours during work hours',
    icon: 'alarm',
    category: 'alerts',
    cronExpr: '0 9,11,13,15,17 * * 1-5',
    prompt: 'Check list_tasks and identify any tasks that appear overdue or have been sitting too long without progress. Report only if there are actionable items — otherwise say nothing.',
  },
  {
    id: 'weekly-review',
    name: 'Weekly Review',
    description: 'Full week recap and next week planning, Sundays at 9:00 AM',
    icon: 'calendar_view_week',
    category: 'weekly',
    cronExpr: '0 9 * * 0',
    prompt: 'Weekly review: call list_tasks to see completed and open work. Summarise what was accomplished this week, what\'s carrying over, and suggest the top 3 priorities for next week.',
  },
  {
    id: 'monday-goals',
    name: 'Monday Goal Setting',
    description: 'Start each week by reviewing and setting weekly goals',
    icon: 'flag',
    category: 'weekly',
    cronExpr: '0 8 * * 1',
    prompt: 'It\'s Monday morning. Review my open tasks and projects, then help me set 3 clear goals for this week. What should I commit to finishing by Friday?',
  },
  {
    id: 'friday-wrapup',
    name: 'Friday Wrap-up',
    description: 'Close out the week and plan the weekend, Fridays at 5:00 PM',
    icon: 'celebration',
    category: 'weekly',
    cronExpr: '0 17 * * 5',
    prompt: 'It\'s Friday. Call list_tasks and give me a quick wrap-up: what got done, what\'s moving to next week, and any loose ends to tie up before the weekend.',
  },
  {
    id: 'email-digest',
    name: 'Email Digest',
    description: 'Summarise your inbox every morning at 8:00 AM (requires Gmail)',
    icon: 'mail',
    category: 'email',
    cronExpr: '0 8 * * *',
    prompt: 'Call gmail_list with query="is:unread" and summarise the most important emails. Flag anything that needs a reply today. Skip newsletters and automated messages.',
  },
  {
    id: 'idea-capture',
    name: 'Idea Capture Reminder',
    description: 'Daily prompt to log ideas at 6:00 PM',
    icon: 'lightbulb',
    category: 'daily',
    cronExpr: '0 18 * * *',
    prompt: 'Evening idea check: remind me to log any ideas, insights, or things I want to explore that came up today. Ask what I want to save to my ideas vault.',
  },
  {
    id: 'project-standup',
    name: 'Project Standup',
    description: 'Daily project status at 10:00 AM on weekdays',
    icon: 'groups',
    category: 'daily',
    cronExpr: '0 10 * * 1-5',
    prompt: 'Quick standup: call list_projects and list_tasks. For each active project, tell me: progress status, blockers, and what\'s next. Keep it to 1-2 lines per project.',
  },
  {
    id: 'achievement-log',
    name: 'Achievement Log',
    description: 'Log today\'s wins every evening at 9:00 PM',
    icon: 'emoji_events',
    category: 'daily',
    cronExpr: '0 21 * * *',
    prompt: 'Ask me what I accomplished today. After I reply, call log_achievement to save it. If I don\'t respond in context, check completed tasks and log those automatically.',
  },
  {
    id: 'monthly-report',
    name: 'Monthly Report',
    description: 'Full performance report on the 1st of each month',
    icon: 'bar_chart',
    category: 'reports',
    cronExpr: '0 9 1 * *',
    prompt: 'Generate my monthly report. Call generate_report with period="monthly". Include tasks completed, projects advanced, ideas captured, and key achievements.',
  },
];

// ── GET /api/aria/workflows ───────────────────────────────────────────────────

workflowsRouter.get('/', (req, res) => {
  const userId = (req.query.userId as string) || 'user-1';
  const active  = loadWorkflows().filter(w => w.userId === userId);
  const activeIds = new Set(active.map(w => w.fromTemplate).filter(Boolean));

  res.json({
    templates: WORKFLOW_TEMPLATES,
    active,
    activeTemplateIds: [...activeIds],
  });
});

// ── POST /api/aria/workflows — activate template or save custom ───────────────

workflowsRouter.post('/', async (req, res) => {
  const { templateId, prompt, name, description, cronExpr, userId = 'user-1' } = req.body as {
    templateId?: string;
    prompt?: string;
    name?: string;
    description?: string;
    cronExpr?: string;
    userId?: string;
  };

  const list = loadWorkflows();

  let record: WorkflowRecord;

  if (templateId) {
    const tpl = WORKFLOW_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) { res.status(404).json({ error: 'Template not found' }); return; }
    if (list.find(w => w.fromTemplate === templateId && w.userId === userId)) {
      res.status(409).json({ error: 'Already active' }); return;
    }
    record = {
      id:          `${templateId}-${Date.now()}`,
      name:        tpl.name,
      description: tpl.description,
      icon:        tpl.icon,
      cronExpr:    tpl.cronExpr,
      prompt:      tpl.prompt,
      userId,
      enabled:     true,
      createdAt:   new Date().toISOString(),
      fromTemplate: templateId,
    };
  } else if (prompt) {
    // AI interprets free-form description → structured workflow
    let parsed: { name: string; description: string; cronExpr: string; prompt: string } | null = null;
    try {
      const result = await claw.run('chat', {
        userId,
        messages: [{
          role: 'user',
          content:
            `Parse this workflow request into JSON with these exact fields: name, description, cronExpr (standard cron, e.g. "0 9 * * 1-5"), prompt (the message ARIA will send to itself when the workflow fires).\n\nRequest: "${prompt}"\n\nReply ONLY with valid JSON, no markdown, no explanation.`,
        }],
      });
      parsed = JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    } catch {
      parsed = null;
    }

    record = {
      id:          `custom-${Date.now()}`,
      name:        name || parsed?.name || 'Custom Workflow',
      description: description || parsed?.description || prompt.slice(0, 80),
      icon:        'auto_awesome',
      cronExpr:    cronExpr || parsed?.cronExpr || '0 9 * * *',
      prompt:      parsed?.prompt || prompt,
      userId,
      enabled:     true,
      createdAt:   new Date().toISOString(),
    };
  } else {
    res.status(400).json({ error: 'templateId or prompt required' }); return;
  }

  list.push(record);
  saveWorkflows(list);
  registerDynamicWorkflow(record);

  res.json({ ok: true, workflow: record });
});

// ── DELETE /api/aria/workflows/:id ───────────────────────────────────────────

workflowsRouter.delete('/:id', (req, res) => {
  const list    = loadWorkflows();
  const updated = list.filter(w => w.id !== req.params.id);
  saveWorkflows(updated);
  unregisterDynamicWorkflow(req.params.id);
  res.json({ ok: true });
});
