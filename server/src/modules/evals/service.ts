import type { Container } from '../../platform/container.js';
import type { EvalDashboard } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { queryEvalDashboardData } from './repository.js';
import { assembleDashboard } from './helpers.js';

/**
 * Global evals service. Provides a workspace-wide (or owner-filtered) view of
 * agent eval metrics. Routes live in `modules/evals/routes.ts`.
 */
export class EvalsService {
  constructor(private container: Container) {}

  /**
   * Return the global eval dashboard for a workspace, optionally filtered to a
   * single agent (`ownerId`).
   *
   * When `ownerId` is provided, verifies the agent belongs to the workspace
   * (404 if not) before fetching raw data and assembling the DTO.
   */
  async getDashboard(workspaceId: string, ownerId?: string): Promise<EvalDashboard> {
    if (ownerId !== undefined) {
      const agent = await this.container.agentsRepo.getById(workspaceId, ownerId);
      if (!agent) throw new NotFoundError('Agent not found');
    }
    const raw = await queryEvalDashboardData(this.container.db, workspaceId, ownerId);
    return assembleDashboard(raw);
  }
}
