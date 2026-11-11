import {
  assertIdentifier,
  createTableSql,
  SYSTEM_FIELDS,
  type EntityDef,
  type FieldDef,
  type ModuleKey,
} from "./entity";

export interface Reference {
  entity: EntityDef;
  field: FieldDef;
}

/** All entity definitions, checked for consistency once, at start-up. */
export class Registry {
  private readonly byKey = new Map<string, EntityDef>();

  constructor(readonly entities: EntityDef[]) {
    const tables = new Set<string>();
    for (const def of entities) {
      assertIdentifier(def.key);
      assertIdentifier(def.table);
      if (this.byKey.has(def.key)) throw new Error(`Duplicate entity key: ${def.key}`);
      if (tables.has(def.table)) throw new Error(`Duplicate table: ${def.table}`);
      this.byKey.set(def.key, def);
      tables.add(def.table);
    }
    for (const def of entities) this.check(def);
  }

  private check(def: EntityDef): void {
    const names = new Set<string>();
    for (const field of def.fields) {
      assertIdentifier(field.name);
      if ((SYSTEM_FIELDS as readonly string[]).includes(field.name)) {
        throw new Error(`${def.key}.${field.name} clashes with a system column`);
      }
      if (names.has(field.name)) throw new Error(`${def.key}.${field.name} is defined twice`);
      names.add(field.name);
      if (field.type === "ref" && !(field.ref && this.byKey.has(field.ref))) {
        throw new Error(`${def.key}.${field.name} references unknown entity ${field.ref}`);
      }
      if (field.type === "select" && !field.options?.length) {
        throw new Error(`${def.key}.${field.name} is a select without options`);
      }
    }
    for (const field of def.fields) {
      if (Array.isArray(field.unique)) {
        for (const scope of field.unique) {
          if (!names.has(scope))
            throw new Error(`${def.key}.${field.name} is unique within unknown field ${scope}`);
        }
      }
    }
  }

  get(key: string): EntityDef {
    const def = this.byKey.get(key);
    if (!def) throw new Error(`Unknown entity: ${key}`);
    return def;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  tableOf = (key: string): string => this.get(key).table;

  /** Entities that hold a reference to `key`, with the referencing field. */
  referencing(key: string): Reference[] {
    const found: Reference[] = [];
    for (const entity of this.entities) {
      for (const field of entity.fields) {
        if (field.type === "ref" && field.ref === key) found.push({ entity, field });
      }
    }
    return found;
  }

  ofModule(module: ModuleKey): EntityDef[] {
    return this.entities.filter((e) => e.module === module);
  }

  /** The statements that create every table of a module. */
  ddl(module: ModuleKey): string[] {
    return this.ofModule(module).flatMap((def) => createTableSql(def, this.tableOf));
  }
}
