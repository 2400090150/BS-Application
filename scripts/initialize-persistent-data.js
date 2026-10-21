const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

async function initializePersistentData() {
  const sourceDataDir = path.resolve(__dirname, "..", "data");
  const dataDir = path.resolve(process.env.DATA_DIR || sourceDataDir);
  const databasePath = path.join(dataDir, "store.sqlite");

  if (dataDir === sourceDataDir || fs.existsSync(databasePath)) return;

  fs.mkdirSync(dataDir, { recursive: true });
  const sourceDatabasePath = path.join(sourceDataDir, "store.sqlite");
  if (!fs.existsSync(sourceDatabasePath)) return;

  const temporaryDatabasePath = `${databasePath}.initializing`;
  fs.rmSync(temporaryDatabasePath, { force: true });
  const sourceDatabase = new Database(sourceDatabasePath, { readonly: true, fileMustExist: true });
  try {
    await sourceDatabase.backup(temporaryDatabasePath);
  } finally {
    sourceDatabase.close();
  }

  const sourceUploadsDir = path.join(sourceDataDir, "uploads");
  if (fs.existsSync(sourceUploadsDir)) {
    fs.cpSync(sourceUploadsDir, path.join(dataDir, "uploads"), { recursive: true, force: true });
  }
  fs.renameSync(temporaryDatabasePath, databasePath);
}

initializePersistentData().catch((error) => {
  console.error("Could not initialize persistent application data:", error);
  process.exitCode = 1;
});
