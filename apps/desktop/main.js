const { app, BrowserWindow, clipboard, Menu, nativeImage, shell } = require('electron');
const path = require('path');

const APP_NAME = 'Zmind';
const DEFAULT_PROTOCOL_SCHEME = 'zmind';
const DEFAULT_APP_URL = 'https://zmind.so/';

const PROTOCOL_SCHEME = (
  process.env.DESKTOP_PROTOCOL_SCHEME || DEFAULT_PROTOCOL_SCHEME
)
  .trim()
  .toLowerCase();

const APP_URL = normalizeAppUrl(process.env.APP_URL || DEFAULT_APP_URL);
const IS_DEV = process.env.NODE_ENV === 'development' || !app.isPackaged;
const IS_LOCAL = isLocalhost(APP_URL);

let mainWindow = null;
let pendingDeepLinkUrl = null;

const OAUTH_URL_PATTERNS = [
  'accounts.google.com',
  'github.com/login/oauth',
  'api.github.com',
  'supabase.co/auth',
  '/auth/v1/authorize',
  'oauth',
  'authorize',
];

if (process.platform === 'darwin') {
  app.setName(APP_NAME);
}
if (process.platform === 'win32') {
  app.setAppUserModelId('so.zmind.desktop');
}

registerProtocolHandler();

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (_event, commandLine) => {
  const deepLink = extractDeepLinkFromArgs(commandLine);
  if (deepLink) {
    handleDeepLink(deepLink);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

if (IS_LOCAL) {
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.commandLine.appendSwitch('ignore-ssl-errors');

  app.on('certificate-error', (event, _contents, url, _error, _certificate, callback) => {
    if (isLocalhost(url)) {
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false);
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    setDockIcon();
  }

  mainWindow = createMainWindow();

  const startupDeepLink = process.platform === 'darwin'
    ? null
    : extractDeepLinkFromArgs(process.argv);
  if (startupDeepLink) {
    handleDeepLink(startupDeepLink);
  }

  const initialUrl = pendingDeepLinkUrl || buildAuthUrl();
  pendingDeepLinkUrl = null;

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    void mainWindow.loadURL(initialUrl).catch((error) => {
      console.error('[desktop] failed to load initial URL:', error);
    });
  }, 120);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          void mainWindow.loadURL(buildAuthUrl());
        }
      }, 120);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function normalizeAppUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return DEFAULT_APP_URL;
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  if (isLocalhost(candidate)) {
    candidate = candidate.replace(/^https:\/\//i, 'http://');
  }

  try {
    const parsed = new URL(candidate);
    if (!parsed.pathname || parsed.pathname === '') {
      parsed.pathname = '/';
    }
    return parsed.toString();
  } catch {
    return DEFAULT_APP_URL;
  }
}

function isLocalhost(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function registerProtocolHandler() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
    return;
  }

  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

function extractDeepLinkFromArgs(args) {
  if (!Array.isArray(args)) return null;
  return args.find((item) => typeof item === 'string' && item.startsWith(`${PROTOCOL_SCHEME}://`)) || null;
}

function buildAuthUrl() {
  return new URL('auth', APP_URL).toString();
}

function buildWebUrlFromDeepLink(deepLinkUrl) {
  if (!deepLinkUrl || !deepLinkUrl.startsWith(`${PROTOCOL_SCHEME}://`)) {
    return null;
  }

  const pathPart = deepLinkUrl.slice(`${PROTOCOL_SCHEME}://`.length);
  try {
    return new URL(pathPart, APP_URL).toString();
  } catch {
    return null;
  }
}

function handleDeepLink(deepLinkUrl) {
  const targetUrl = buildWebUrlFromDeepLink(deepLinkUrl);
  if (!targetUrl) return;

  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingDeepLinkUrl = targetUrl;
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();

  void mainWindow.loadURL(targetUrl).catch((error) => {
    console.error('[desktop] failed to load deep-link URL:', error);
  });
}

function shouldOpenOAuthPopup(url) {
  return OAUTH_URL_PATTERNS.some((pattern) => url.includes(pattern));
}

function isSameOriginWithApp(urlString) {
  try {
    const target = new URL(urlString);
    const appOrigin = new URL(APP_URL).origin;
    return target.origin === appOrigin;
  } catch {
    return false;
  }
}

function shouldRedirectToAuth(urlString) {
  if (!isSameOriginWithApp(urlString)) return false;

  try {
    const parsed = new URL(urlString);
    return parsed.pathname === '/' || parsed.pathname === '';
  } catch {
    return false;
  }
}

function isAuthCallback(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.pathname.startsWith('/auth/callback');
  } catch {
    return false;
  }
}

function createMainWindow() {
  const iconPath = process.platform === 'darwin'
    ? path.resolve(__dirname, 'assets', 'icon.icns')
    : process.platform === 'win32'
      ? path.resolve(__dirname, 'assets', 'icon.ico')
      : path.resolve(__dirname, 'assets', 'icon.png');

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#000000',
    icon: iconPath,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: !IS_LOCAL,
    },
  });

  const contents = window.webContents;
  contents.setUserAgent(`${contents.getUserAgent()} Electron/Zmind-Desktop`);

  createApplicationMenu(window);

  window.once('ready-to-show', () => {
    window.show();
  });

  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHTML(APP_NAME))}`);

  contents.on('will-navigate', (event, navigationUrl) => {
    if (shouldOpenOAuthPopup(navigationUrl)) {
      event.preventDefault();
      openOAuthWindow(window, navigationUrl);
      return;
    }

    if (shouldRedirectToAuth(navigationUrl)) {
      event.preventDefault();
      void window.loadURL(buildAuthUrl());
      return;
    }

    if (!isSameOriginWithApp(navigationUrl)) {
      event.preventDefault();
      void shell.openExternal(navigationUrl);
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenOAuthPopup(url)) {
      openOAuthWindow(window, url);
      return { action: 'deny' };
    }

    if (isSameOriginWithApp(url)) {
      void window.loadURL(url);
      return { action: 'deny' };
    }

    void shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('did-navigate', (_event, url) => {
    if (shouldRedirectToAuth(url)) {
      void window.loadURL(buildAuthUrl());
    }
  });

  contents.on('did-navigate-in-page', (_event, url) => {
    if (shouldRedirectToAuth(url)) {
      void window.loadURL(buildAuthUrl());
    }
  });

  return window;
}

function openOAuthWindow(parentWindow, url) {
  const oauthWindow = new BrowserWindow({
    width: 600,
    height: 800,
    parent: parentWindow,
    modal: false,
    autoHideMenuBar: true,
    title: 'Sign In',
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const contents = oauthWindow.webContents;

  oauthWindow.once('ready-to-show', () => {
    oauthWindow.show();
  });

  const onNavigate = (event, callbackUrl) => {
    if (!isAuthCallback(callbackUrl) && !isSameOriginWithApp(callbackUrl)) {
      return;
    }

    event.preventDefault();
    if (!oauthWindow.isDestroyed()) {
      oauthWindow.close();
    }

    if (parentWindow && !parentWindow.isDestroyed()) {
      void parentWindow.loadURL(callbackUrl);
      if (parentWindow.isMinimized()) {
        parentWindow.restore();
      }
      parentWindow.focus();
    }
  };

  contents.on('will-navigate', onNavigate);
  contents.on('will-redirect', onNavigate);

  oauthWindow.on('closed', () => {
    contents.removeListener('will-navigate', onNavigate);
    contents.removeListener('will-redirect', onNavigate);
  });

  void oauthWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHTML('Signing in...'))}`);
  setTimeout(() => {
    if (!oauthWindow.isDestroyed()) {
      void oauthWindow.loadURL(url);
    }
  }, 80);
}

function createApplicationMenu(window) {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+Left',
          click: () => {
            if (window.webContents.navigationHistory.canGoBack()) {
              window.webContents.navigationHistory.goBack();
            }
          },
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+Right',
          click: () => {
            if (window.webContents.navigationHistory.canGoForward()) {
              window.webContents.navigationHistory.goForward();
            }
          },
        },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => window.webContents.reload(),
        },
        { type: 'separator' },
        {
          label: 'Copy Current URL',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => {
            clipboard.writeText(window.webContents.getURL() || APP_URL);
          },
        },
        {
          label: 'Open Current URL in Browser',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            const current = window.webContents.getURL() || APP_URL;
            void shell.openExternal(current);
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        ...(IS_DEV ? [{ role: 'toggleDevTools' }] : []),
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' }, { role: 'front' }]
          : [{ role: 'close' }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setDockIcon() {
  const iconPath = path.resolve(__dirname, 'assets', 'icon.icns');
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) {
    app.dock.setIcon(icon);
  }
}

function loadingHTML(label) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${APP_NAME}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      color: rgba(255, 255, 255, 0.72);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(255, 255, 255, 0.15);
      border-top-color: rgba(255, 255, 255, 0.9);
      border-radius: 999px;
      animation: spin 0.85s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="spinner"></div>
    <div>${label}</div>
  </div>
</body>
</html>
`;
}
