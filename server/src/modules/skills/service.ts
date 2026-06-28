import type { Skill } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { SkillsRepository } from './repository.js';
import { toSkillDto } from './helpers.js';

/** A1 — skills service. Thin delegation to repository with workspace-scope enforcement. */
export class SkillsService {
  private repo: SkillsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(
    workspaceId: string,
    input: {
      name: string;
      description: string;
      type: 'rubric' | 'convention' | 'security' | 'custom';
      body: string;
      source?: 'manual' | 'imported_url' | 'extracted' | 'community';
      enabled?: boolean;
    },
  ): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source ?? 'manual',
      body: input.body,
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: {
      name?: string;
      description?: string;
      type?: 'rubric' | 'convention' | 'security' | 'custom';
      body?: string;
    },
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    return row ? toSkillDto(row) : undefined;
  }

  async toggle(workspaceId: string, id: string, enabled: boolean): Promise<Skill | undefined> {
    const row = await this.repo.toggle(workspaceId, id, enabled);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.delete(workspaceId, id);
  }
}
