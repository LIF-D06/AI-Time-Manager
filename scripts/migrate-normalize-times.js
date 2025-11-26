import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function migrate() {
  const dbPath = process.env.WEBSITE_INSTANCE_ID ? '/home/data/users.db' : './users.db';
  console.log(`Opening DB: ${dbPath}`);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  try {
    const rows = await db.all('SELECT id, startTime, endTime, dueDate FROM tasks');
    console.log(`Found ${rows.length} tasks, checking time normalization...`);

    let updated = 0;
    for (const r of rows) {
      const newStart = normalizeTime(r.startTime);
      const newEnd = normalizeTime(r.endTime);
      const newDue = normalizeTime(r.dueDate);

      // Only update if any normalized value differs and is valid
      const needUpdate = (newStart && newStart !== r.startTime) || (newEnd && newEnd !== r.endTime) || (newDue && newDue !== r.dueDate);
      if (needUpdate) {
        await db.run(
          `UPDATE tasks SET startTime = ?, endTime = ?, dueDate = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
          [newStart || r.startTime, newEnd || r.endTime, newDue || r.dueDate, r.id]
        );
        updated++;
        console.log(`Updated task ${r.id}`);
      }
    }

    console.log(`Migration completed. ${updated} rows updated.`);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

function normalizeTime(value) {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch (e) {
    return null;
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
