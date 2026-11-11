import type { Workspace } from "../data/workspace";
import { getSetting, setSetting } from "../data/system";
import { namedId } from "../lib/ids";
import { DEFAULT_ACCOUNTS } from "./accounting";

const DEFAULT_STAGES = [
  { name: "Nuovo contatto", position: 1, probability: 10, kind: "open" },
  { name: "Qualificata", position: 2, probability: 30, kind: "open" },
  { name: "Proposta inviata", position: 3, probability: 60, kind: "open" },
  { name: "Trattativa", position: 4, probability: 80, kind: "open" },
  { name: "Vinta", position: 5, probability: 100, kind: "won" },
  { name: "Persa", position: 6, probability: 0, kind: "lost" },
];

/** Reference data every installation needs. Runs once; the user can edit it afterwards. */
export async function seedDefaults(ws: Workspace): Promise<void> {
  if (await getSetting<boolean>(ws.db, "seed.done")) return;
  await ws.transact(async (tx, ctx, repo) => {
    for (const account of DEFAULT_ACCOUNTS) {
      await repo("account").create(tx, ctx, {
        id: await namedId(`account:${account.code}`),
        ...account,
      });
    }
    for (const stage of DEFAULT_STAGES) {
      await repo("pipeline_stage").create(tx, ctx, {
        id: await namedId(`stage:${stage.name}`),
        ...stage,
      });
    }
    await setSetting(tx, "seed.done", true, ctx.now());
  });
}
