// Plan-then-apply: a dry run mints a plan_id, a second call with that id applies it.
// Plans live in memory only (they are cheap to redo) and are single use.
import { createHash, randomBytes } from 'node:crypto';
import type { Change } from './changes';
import { UserError } from './errors';

const PLAN_TTL_MS = 15 * 60_000;
export const MAX_ITEMS_PER_APPLY = 500;
/** Additive writes touching more than this many items need a plan too. */
export const DIRECT_WRITE_LIMIT = 50;

export interface Plan {
  id: string;
  tool: string;
  argsHash: string;
  /** The arguments themselves, so a mismatch can say which one differs. */
  args: Record<string, unknown>;
  libraryId: string;
  /** Hash of the full change list the agent was shown. Recomputed at apply time to detect stale plans. */
  digest: string;
  /** The full change list, for plan_changes to page through. */
  changes: Change[];
  expiresAt: number;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }
    return v;
  });
}

export function hashOf(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export class PlanStore {
  private plans = new Map<string, Plan>();
  constructor(private now: () => number = Date.now) {}

  mint(p: Omit<Plan, 'id' | 'expiresAt'>): Plan {
    const t = this.now();
    for (const [id, old] of this.plans) if (old.expiresAt <= t) this.plans.delete(id);
    const plan: Plan = {
      ...p,
      id: `plan_${randomBytes(12).toString('hex')}`,
      expiresAt: t + PLAN_TTL_MS,
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  /** A live plan by id, or a clear error. Does not consume it. */
  get(id: string): Plan {
    const plan = this.plans.get(id);
    if (!plan || plan.expiresAt <= this.now()) {
      this.plans.delete(id);
      throw new UserError(
        'That plan_id is unknown, expired (plans last 15 minutes) or was already applied. Call the tool again without plan_id to get a fresh dry run.',
      );
    }
    return plan;
  }

  /** Look a plan up and check it belongs to exactly this call. Does not consume it. */
  check(
    id: string,
    tool: string,
    args: Record<string, unknown>,
    argsHash: string,
    libraryId: string,
  ): Plan {
    const plan = this.get(id);
    if (plan.tool !== tool)
      throw new UserError(
        `That plan_id was made for ${plan.tool}, not ${tool}. Plans only apply to the tool and arguments they were made for.`,
      );
    if (plan.argsHash !== argsHash) {
      const keys = [...new Set([...Object.keys(plan.args), ...Object.keys(args)])];
      const differ = keys.filter((k) => hashOf(plan.args[k] ?? null) !== hashOf(args[k] ?? null));
      throw new UserError(
        `These arguments differ from the dry run this plan_id was made for: ${differ.join(', ') || '(their order)'}. Call again with exactly the same arguments plus plan_id, or run a new dry run.`,
      );
    }
    if (plan.libraryId !== libraryId)
      throw new UserError('This plan was made for another library. Run a new dry run.');
    return plan;
  }

  /** Consume a plan. Returns false if someone else already did (a double submit). */
  take(id: string): boolean {
    return this.plans.delete(id);
  }

  clear(): void {
    this.plans.clear();
  }
}
