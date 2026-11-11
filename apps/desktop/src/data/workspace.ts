import type { Database, SqlRunner } from "./db";
import type { Ctx, EntityDef, Rec } from "./entity";
import { runMigrations, type Migration } from "./migrations";
import { Registry } from "./registry";
import { EntityRepository, type ListOptions, type Page } from "./repository";
import { SYSTEM_MIGRATION, getSetting, setSetting } from "./system";
import { todayLocal } from "../lib/dates";
import { uuidv7 } from "../lib/ids";

export interface WorkspaceOptions {
  db: Database;
  entities: EntityDef[];
  /** Migrations after the system one, in order; ids continue from 2. */
  migrations: (registry: Registry) => Migration[];
  clock?: () => Date;
}

/**
 * The open company file: the database, the entity registry and the operations on records.
 * Every write goes through a transaction that also writes the audit trail (and the sync
 * outbox when a server is linked).
 */
export class Workspace {
  private constructor(
    readonly db: Database,
    readonly registry: Registry,
    readonly deviceId: string,
    private syncEnabled: boolean,
    private readonly clock: () => Date,
    private actor: string,
  ) {}

  static async open(options: WorkspaceOptions): Promise<Workspace> {
    const registry = new Registry(options.entities);
    const clock = options.clock ?? (() => new Date());
    await runMigrations(options.db, [SYSTEM_MIGRATION, ...options.migrations(registry)]);

    let deviceId = await getSetting<string>(options.db, "device.id");
    if (!deviceId) {
      deviceId = uuidv7();
      await setSetting(options.db, "device.id", deviceId, clock().toISOString());
    }
    const sync = (await getSetting<boolean>(options.db, "sync.enabled")) ?? false;
    const actor = (await getSetting<string>(options.db, "user.name")) ?? "Utente locale";
    return new Workspace(options.db, registry, deviceId, sync, clock, actor);
  }

  get ctx(): Ctx {
    return {
      now: () => this.clock().toISOString(),
      today: () => todayLocal(this.clock()),
      newId: () => uuidv7(this.clock().getTime()),
      deviceId: this.deviceId,
      syncEnabled: this.syncEnabled,
      actor: this.actor,
    };
  }

  repo(key: string): EntityRepository {
    return new EntityRepository(this.registry.get(key), this.registry);
  }

  async setActor(name: string): Promise<void> {
    this.actor = name;
    await setSetting(this.db, "user.name", name, this.ctx.now());
  }

  async setSyncEnabled(enabled: boolean): Promise<void> {
    this.syncEnabled = enabled;
    await setSetting(this.db, "sync.enabled", enabled, this.ctx.now());
  }

  // --- record operations (each one atomic) -------------------------------------------

  list(key: string, options?: ListOptions): Promise<Page> {
    return this.repo(key).list(this.db, options);
  }

  get(key: string, id: string): Promise<Rec | null> {
    return this.repo(key).get(this.db, id);
  }

  create(key: string, input: Record<string, unknown>): Promise<Rec> {
    return this.db.transaction((tx) => this.repo(key).create(tx, this.ctx, input));
  }

  update(
    key: string,
    id: string,
    patch: Record<string, unknown>,
    expectedVersion?: number,
  ): Promise<Rec> {
    return this.db.transaction((tx) =>
      this.repo(key).update(
        tx,
        this.ctx,
        id,
        patch,
        expectedVersion === undefined ? {} : { expectedVersion },
      ),
    );
  }

  remove(key: string, id: string, expectedVersion?: number): Promise<void> {
    return this.db.transaction((tx) =>
      this.repo(key).remove(
        tx,
        this.ctx,
        id,
        expectedVersion === undefined ? {} : { expectedVersion },
      ),
    );
  }

  /** Runs several operations as one atomic unit (for business logic spanning entities). */
  transact<T>(
    fn: (tx: SqlRunner, ctx: Ctx, repo: (key: string) => EntityRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction((tx) => fn(tx, this.ctx, (key) => this.repo(key)));
  }
}
