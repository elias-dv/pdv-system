'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
const { getDb, getDatabasePath } = require('../database/db');

function getBackupDir() {
  const customPath = process.env.BACKUP_PATH;
  if (customPath && fs.existsSync(customPath)) return customPath;

  const backupDir = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  return backupDir;
}

async function createBackup(trigger = 'auto') {
  const db      = getDb();
  const srcPath = getDatabasePath();

  if (!fs.existsSync(srcPath)) {
    console.log('[BACKUP] Database file not found, skipping.');
    return { success: false, reason: 'no_database' };
  }

  const backupDir = getBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename  = `pdv_backup_${timestamp}.sqlite`;
  const destPath  = path.join(backupDir, filename);

  try {
    // better-sqlite3 v11: db.backup() returns a Promise — must await
    await db.backup(destPath);

    const stats     = fs.statSync(destPath);
    const sizeBytes = stats.size;

    // Log to database
    db.prepare(`
      INSERT INTO backup_log (file_path, status, size_bytes, trigger)
      VALUES (?, 'success', ?, ?)
    `).run(destPath, sizeBytes, trigger);

    // Update last backup date
    db.prepare(`
      INSERT OR REPLACE INTO settings (key, value, updated_at)
      VALUES ('last_backup_date', datetime('now','localtime'), datetime('now','localtime'))
    `).run();

    // Prune old backups
    pruneOldBackups(backupDir, db);

    console.log(`[BACKUP] Created: ${filename} (${(sizeBytes / 1024).toFixed(1)} KB)`);
    return { success: true, path: destPath, filename, sizeBytes };

  } catch (err) {
    console.error('[BACKUP] Failed:', err.message);

    try {
      db.prepare(`
        INSERT INTO backup_log (file_path, status, size_bytes, trigger)
        VALUES (?, 'error', 0, ?)
      `).run(destPath, trigger);
    } catch (_) {}

    return { success: false, error: err.message };
  }
}

function pruneOldBackups(backupDir, db) {
  try {
    const maxFiles = parseInt(
      db.prepare("SELECT value FROM settings WHERE key='backup_max_files'").get()?.value || '30'
    );

    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('pdv_backup_') && f.endsWith('.sqlite'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    const toDelete = files.slice(maxFiles);
    for (const file of toDelete) {
      fs.unlinkSync(path.join(backupDir, file.name));
      console.log(`[BACKUP] Pruned old backup: ${file.name}`);
    }
  } catch (err) {
    console.error('[BACKUP] Prune error:', err.message);
  }
}

function scheduleBackup() {
  const db = getDb();

  function checkAndBackup() {
    try {
      const lastBackup = db.prepare("SELECT value FROM settings WHERE key='last_backup_date'").get()?.value || '';
      const today = new Date().toISOString().slice(0, 10);
      const lastDate = lastBackup ? lastBackup.slice(0, 10) : '';

      if (lastDate !== today) {
        console.log('[BACKUP] Daily backup triggered (new day).');
        createBackup('schedule').catch(err => console.error('[BACKUP] Schedule error:', err.message));
      }
    } catch (err) {
      console.error('[BACKUP] Schedule check error:', err.message);
    }
  }

  // Check at startup
  checkAndBackup();

  // Then check every hour
  setInterval(checkAndBackup, 60 * 60 * 1000);

  // Also check against the configured schedule time
  const scheduledTime = (process.env.BACKUP_SCHEDULE_TIME || '23:50').split(':');
  const [targetH, targetM] = scheduledTime.map(Number);

  setInterval(() => {
    const now = new Date();
    if (now.getHours() === targetH && now.getMinutes() === targetM) {
      console.log(`[BACKUP] Scheduled backup at ${targetH}:${String(targetM).padStart(2,'0')}`);
      createBackup('schedule_time').catch(err => console.error('[BACKUP] Scheduled error:', err.message));
    }
  }, 60 * 1000); // Check every minute

  console.log(`[BACKUP] Scheduler active. Daily at ${targetH}:${String(targetM).padStart(2,'0')}`);
}

function getBackupHistory() {
  const db = getDb();
  return db.prepare(`
    SELECT id, created_at, file_path, status, size_bytes, trigger
    FROM backup_log
    ORDER BY created_at DESC
    LIMIT 50
  `).all();
}

module.exports = { createBackup, scheduleBackup, getBackupDir, getBackupHistory };
