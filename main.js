'use strict';

require('dotenv').config();

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');

const { initializeDatabase }  = require('./src/database/db');
const { registerIpcHandlers } = require('./src/ipc/handlers');
const { scheduleBackup, createBackup } = require('./src/services/backupService');

let mainWindow;

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1280,
    height:    820,
    minWidth:  1100,
    minHeight: 700,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#F5F5F7',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Graceful close: backup first
  mainWindow.on('close', async (e) => {
    e.preventDefault();

    try {
      createBackup('app_close');
    } catch (err) {
      console.error('[MAIN] Backup on close failed:', err.message);
    }

    mainWindow.destroy();
  });

  // Open external links in browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── Misc IPC (shell / dialogs) ──────────────────────────────────────────────

function registerMiscHandlers() {
  ipcMain.handle('app:openFolder', (_, folderPath) => {
    shell.openPath(folderPath);
    return true;
  });

  ipcMain.handle('app:showMessageBox', (_, opts) => {
    return dialog.showMessageBox(mainWindow, opts);
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  initializeDatabase();
  registerIpcHandlers();
  registerMiscHandlers();
  scheduleBackup();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[MAIN] Uncaught exception:', err);
});
