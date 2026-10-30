/**
 * Umbra IA — application de bureau (Electron)
 *
 * Démarre le serveur Umbra dans le processus principal, puis affiche
 * l'interface dans une fenêtre native. Aucune barre d'adresse, aucun onglet :
 * Umbra devient un vrai logiciel, comme n'importe quelle app de bureau.
 */
import { app, BrowserWindow, Menu, shell, dialog, nativeTheme } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const URL = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let server = null;

// Un seul exemplaire d'Umbra à la fois
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

async function startServer() {
  process.env.PORT = String(PORT);
  process.env.HOST = '127.0.0.1';
  try {
    // Le serveur est un module ESM qui écoute dès son import
    const mod = await import(path.join(ROOT, 'server', 'index.js'));
    server = mod.server;
  } catch (err) {
    dialog.showErrorBox(
      'Umbra IA — démarrage impossible',
      `Le serveur n'a pas pu démarrer :\n\n${err?.message || err}\n\nVérifie que le port ${PORT} est libre.`,
    );
    app.quit();
  }
}

async function waitForServer(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${URL}/api/health`);
      if (res.ok) return true;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Umbra',
      submenu: [
        { label: 'Nouvelle conversation', accelerator: 'CmdOrCtrl+K', click: () => mainWindow?.webContents.executeJavaScript("document.getElementById('newChat').click()") },
        { label: 'Mémoire', click: () => mainWindow?.webContents.executeJavaScript("document.getElementById('openMemory').click()") },
        { label: 'Réglages', accelerator: 'CmdOrCtrl+,', click: () => mainWindow?.webContents.executeJavaScript("document.getElementById('openSettings').click()") },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Quitter Umbra' },
      ],
    },
    { role: 'editMenu', label: 'Édition' },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { role: 'resetZoom', label: 'Taille normale' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'Guide d’installation',
          click: () => shell.openExternal('https://github.com/'),
        },
        { label: 'Version 2.0.0', enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 420,
    minHeight: 560,
    show: false,
    backgroundColor: '#100d0c',
    title: 'Umbra IA',
    icon: path.join(ROOT, 'web', 'icons', 'icon-512.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(URL);

  // Les liens externes s'ouvrent dans le vrai navigateur
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.startsWith(URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  await startServer();
  const ready = await waitForServer();
  if (!ready) {
    dialog.showErrorBox('Umbra IA', "Le serveur local n'a pas répondu dans les temps. Réessaie en fermant les autres instances.");
    app.quit();
    return;
  }
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  try {
    await server?.close?.();
  } catch {
    /* ignore */
  }
});
