import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @description Store inventory state and indexed settlement receipts in one SQLite transaction.
 * @param {string} directory Private inventory directory.
 * @returns {object} Transactional state and settlement operations.
 */
export function createInventoryStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, "inventory.sqlite");
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(
    "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settlements (session TEXT NOT NULL, record TEXT NOT NULL, signature TEXT NOT NULL, paid INTEGER NOT NULL, PRIMARY KEY(session, record)) WITHOUT ROWID;",
  );
  const read = db.prepare("SELECT value FROM inventory WHERE id=1");
  const write = db.prepare(
    "INSERT INTO inventory(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
  );
  const receipt = db.prepare(
    "SELECT signature,paid FROM settlements WHERE session=? AND record=?",
  );
  const settle = db.prepare(
    "INSERT INTO settlements VALUES(?,?,?,?) ON CONFLICT(session,record) DO UPDATE SET signature=excluded.signature,paid=excluded.paid",
  );
  let needsMigration = false;
  return {
    get needsMigration() {
      return needsMigration;
    },
    begin: () => db.exec("BEGIN IMMEDIATE"),
    commit: () => db.exec("COMMIT"),
    rollback: () => db.exec("ROLLBACK"),
    close: () => db.close(),
    load() {
      const row = read.get();
      needsMigration = !row;
      if (row) return JSON.parse(row.value);
      try {
        return JSON.parse(
          readFileSync(join(directory, "inventory.json"), "utf8"),
        );
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    save(value) {
      for (const [session, records] of Object.entries(value.settlements || {}))
        for (const [record, data] of Object.entries(records)) {
          if (
            !Number.isSafeInteger(data.paid) ||
            data.paid < 0 ||
            typeof data.signature !== "string"
          )
            throw Error("invalid-settlement");
          settle.run(session, record, data.signature, data.paid);
        }
      const {
        settlements: _settlements,
        sessions: _sessions,
        bonusSessions: _bonusSessions,
        ...state
      } = value;
      write.run(JSON.stringify(state));
    },
    receipt: (session, record) => receipt.get(session, record),
    settle: (session, record, value) =>
      settle.run(session, record, value.signature, value.paid),
  };
}
