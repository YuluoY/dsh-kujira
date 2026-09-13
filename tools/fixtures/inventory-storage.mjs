import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";
import {rm, writeFile} from "node:fs/promises";
import {executeInventory} from "../../lib/host/inventory-service.js";

export function readInventory(directory) {
  const db = new DatabaseSync(join(directory, "inventory.sqlite"));
  try {
    const state = JSON.parse(db.prepare("SELECT value FROM inventory WHERE id=1").get().value);
    state.settlements = {};
    for (const {session, record, signature, paid} of db.prepare("SELECT * FROM settlements").all())
      (state.settlements[session] ||= {})[record] = {signature, paid};
    state.sessions = {};
    state.bonusSessions = {};
    return state;
  } finally {db.close();}
}

export async function seedLegacyInventory(directory, value) {
  await executeInventory({directory, action:"close"});
  for (const suffix of ["", "-wal", "-shm"]) await rm(join(directory, "inventory.sqlite" + suffix), {force:true});
  await writeFile(join(directory, "inventory.json"), JSON.stringify(value));
}

export function rejectInventoryWrites(directory) {
  const db = new DatabaseSync(join(directory, "inventory.sqlite"));
  db.exec("CREATE TRIGGER reject_test_write BEFORE UPDATE ON inventory BEGIN SELECT RAISE(ABORT,'test-storage-failure'); END");
  db.close();
}
