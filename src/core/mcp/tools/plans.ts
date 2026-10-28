// Paging through a dry run's full change list: the dry run itself shows only the first rows.
import { z } from 'zod';
import { clipped } from '../changes';
import { UserError } from '../errors';
import { openLibrary, type Tool } from '../kit';
import { library } from '../schemas';

export function registerPlanTool(tool: Tool): void {
  tool(
    'plan_changes',
    {
      title: 'Plan changes',
      description: 'All rows of a dry run that was cut short. Does not use the plan up.',
      input: z.strictObject({
        library,
        plan_id: z.string().min(1),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      kind: 'read',
    },
    async ({ plan_id, offset = 0, limit = 100 }, call) => {
      const plan = call.state.plans.get(plan_id);
      if (plan.libraryId !== (await openLibrary(call)).ref.id)
        throw new UserError('That plan was made for another library.');
      const rows = plan.changes.slice(offset, offset + limit);
      return {
        tool: plan.tool,
        changes: rows.map(clipped),
        offset,
        returned: rows.length,
        total: plan.changes.length,
        has_more: offset + rows.length < plan.changes.length,
      };
    },
  );
}
