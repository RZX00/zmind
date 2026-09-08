const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let familySync = null;
let MUSL = null;
try {
  ({ familySync, MUSL } = require('detect-libc'));
} catch {
  familySync = null;
  MUSL = null;
}

function moduleDir(projectRoot, moduleName) {
  return path.join(projectRoot, 'node_modules', ...moduleName.split('/'));
}

function loadPackageJson(projectRoot, moduleName) {
  try {
    return require(path.join(moduleDir(projectRoot, moduleName), 'package.json'));
  } catch {
    return null;
  }
}

function hasProjectModule(projectRoot, moduleName) {
  const modulePath = moduleDir(projectRoot, moduleName);
  return fs.existsSync(modulePath) && fs.existsSync(path.join(modulePath, 'package.json'));
}

function detectLibcFlavor() {
  if (process.platform !== 'linux') {
    return null;
  }

  const family = familySync ? familySync() : null;
  return family === MUSL ? 'musl' : 'gnu';
}

function runtimeKey() {
  const libc = detectLibcFlavor();
  return `${process.platform}/${process.arch}${libc ? `/${libc}` : ''}`;
}

function resolveLightningcssPackage() {
  const key = runtimeKey();
  const mapping = {
    'win32/x64': 'lightningcss-win32-x64-msvc',
    'win32/arm64': 'lightningcss-win32-arm64-msvc',
    'darwin/x64': 'lightningcss-darwin-x64',
    'darwin/arm64': 'lightningcss-darwin-arm64',
    'linux/x64/gnu': 'lightningcss-linux-x64-gnu',
    'linux/x64/musl': 'lightningcss-linux-x64-musl',
    'linux/arm64/gnu': 'lightningcss-linux-arm64-gnu',
    'linux/arm64/musl': 'lightningcss-linux-arm64-musl',
    'linux/arm/gnu': 'lightningcss-linux-arm-gnueabihf',
    'freebsd/x64': 'lightningcss-freebsd-x64',
    'android/arm64': 'lightningcss-android-arm64',
  };
  return mapping[key] || null;
}

function resolveNextSwcPackage() {
  const key = runtimeKey();
  const mapping = {
    'win32/x64': '@next/swc-win32-x64-msvc',
    'win32/arm64': '@next/swc-win32-arm64-msvc',
    'darwin/x64': '@next/swc-darwin-x64',
    'darwin/arm64': '@next/swc-darwin-arm64',
    'linux/x64/gnu': '@next/swc-linux-x64-gnu',
    'linux/x64/musl': '@next/swc-linux-x64-musl',
    'linux/arm64/gnu': '@next/swc-linux-arm64-gnu',
    'linux/arm64/musl': '@next/swc-linux-arm64-musl',
  };
  return mapping[key] || null;
}

function resolveParcelWatcherPackage() {
  const key = runtimeKey();
  const mapping = {
    'win32/x64': '@parcel/watcher-win32-x64',
    'win32/arm64': '@parcel/watcher-win32-arm64',
    'win32/ia32': '@parcel/watcher-win32-ia32',
    'darwin/x64': '@parcel/watcher-darwin-x64',
    'darwin/arm64': '@parcel/watcher-darwin-arm64',
    'linux/x64/gnu': '@parcel/watcher-linux-x64-glibc',
    'linux/x64/musl': '@parcel/watcher-linux-x64-musl',
    'linux/arm64/gnu': '@parcel/watcher-linux-arm64-glibc',
    'linux/arm64/musl': '@parcel/watcher-linux-arm64-musl',
    'linux/arm/gnu': '@parcel/watcher-linux-arm-glibc',
    'linux/arm/musl': '@parcel/watcher-linux-arm-musl',
    'freebsd/x64': '@parcel/watcher-freebsd-x64',
    'android/arm64': '@parcel/watcher-android-arm64',
  };
  return mapping[key] || null;
}

function resolveSwcCorePackage() {
  const key = runtimeKey();
  const mapping = {
    'win32/x64': '@swc/core-win32-x64-msvc',
    'win32/arm64': '@swc/core-win32-arm64-msvc',
    'win32/ia32': '@swc/core-win32-ia32-msvc',
    'darwin/x64': '@swc/core-darwin-x64',
    'darwin/arm64': '@swc/core-darwin-arm64',
    'linux/x64/gnu': '@swc/core-linux-x64-gnu',
    'linux/x64/musl': '@swc/core-linux-x64-musl',
    'linux/arm64/gnu': '@swc/core-linux-arm64-gnu',
    'linux/arm64/musl': '@swc/core-linux-arm64-musl',
    'linux/arm/gnu': '@swc/core-linux-arm-gnueabihf',
  };
  return mapping[key] || null;
}

function resolveTailwindOxidePackage() {
  const key = runtimeKey();
  const mapping = {
    'win32/x64': '@tailwindcss/oxide-win32-x64-msvc',
    'win32/arm64': '@tailwindcss/oxide-win32-arm64-msvc',
    'darwin/x64': '@tailwindcss/oxide-darwin-x64',
    'darwin/arm64': '@tailwindcss/oxide-darwin-arm64',
    'linux/x64/gnu': '@tailwindcss/oxide-linux-x64-gnu',
    'linux/x64/musl': '@tailwindcss/oxide-linux-x64-musl',
    'linux/arm64/gnu': '@tailwindcss/oxide-linux-arm64-gnu',
    'linux/arm64/musl': '@tailwindcss/oxide-linux-arm64-musl',
    'linux/arm/gnu': '@tailwindcss/oxide-linux-arm-gnueabihf',
    'freebsd/x64': '@tailwindcss/oxide-freebsd-x64',
    'android/arm64': '@tailwindcss/oxide-android-arm64',
  };
  return mapping[key] || null;
}

function resolveOptionalVersion(projectRoot, ownerModule, optionalDep) {
  const ownerPkg = loadPackageJson(projectRoot, ownerModule);
  if (!ownerPkg) return 'latest';

  if (ownerPkg.optionalDependencies && ownerPkg.optionalDependencies[optionalDep]) {
    return ownerPkg.optionalDependencies[optionalDep];
  }

  if (ownerPkg.version) {
    return ownerPkg.version;
  }

  return 'latest';
}

function canLoadModule(projectRoot, moduleName) {
  try {
    require(moduleDir(projectRoot, moduleName));
    return true;
  } catch {
    return false;
  }
}

function canLoadLightningcss(projectRoot) {
  try {
    require(path.join(moduleDir(projectRoot, 'lightningcss'), 'node'));
    return true;
  } catch {
    return false;
  }
}

function ensureNovelTiptapPeers(projectRoot) {
  const requiredModules = ['@tiptap/core', '@tiptap/pm'];
  const missing = requiredModules.filter((moduleName) => !hasProjectModule(projectRoot, moduleName));

  if (missing.length === 0) {
    return true;
  }

  const novelNodeModules = path.join(moduleDir(projectRoot, 'novel'), 'node_modules');
  if (!fs.existsSync(novelNodeModules)) {
    console.error(
      `[dependency-heal] Missing novel dependency tree at ${novelNodeModules}. Cannot restore ${missing.join(', ')}.`,
    );
    return false;
  }

  for (const moduleName of missing) {
    const sourceDir = path.join(novelNodeModules, ...moduleName.split('/'));
    const targetDir = moduleDir(projectRoot, moduleName);

    if (!fs.existsSync(sourceDir)) {
      console.error(
        `[dependency-heal] Missing ${moduleName} under novel dependencies (${sourceDir}).`,
      );
      return false;
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    console.log(`[dependency-heal] Restored ${moduleName} from novel dependency tree.`);
  }

  return requiredModules.every((moduleName) => hasProjectModule(projectRoot, moduleName));
}

function installPackage(projectRoot, packageName, version) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const cacheDir = path.join(projectRoot, '.npm-cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const packageSpec = `${packageName}@${version}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightningcss-binding-'));

  try {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'lightningcss-binding-installer', private: true }),
    );

    const args = [
      'install',
      packageSpec,
      '--no-save',
      '--force',
      '--ignore-scripts',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
    ];
    const result = spawnSync(npmCommand, args, {
      cwd: tempDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_cache: cacheDir,
      },
    });
    if (result.status !== 0) {
      return false;
    }

    const sourceDir = path.join(tempDir, 'node_modules', packageName);
    const targetDir = moduleDir(projectRoot, packageName);
    if (!fs.existsSync(sourceDir)) {
      return false;
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    fs.cpSync(sourceDir, targetDir, { recursive: true });
    return true;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function main() {
  const projectRoot = path.join(__dirname, '..');

  if (!ensureNovelTiptapPeers(projectRoot)) {
    console.error(
      '[dependency-heal] Failed to restore required tiptap modules. Please run "npm install" in frontend and retry.',
    );
    process.exit(1);
  }

  const targets = [
    {
      label: 'lightningcss',
      moduleName: resolveLightningcssPackage(),
      ownerModule: 'lightningcss',
      isReady: () => canLoadLightningcss(projectRoot),
    },
    {
      label: 'next-swc',
      moduleName: resolveNextSwcPackage(),
      ownerModule: 'next',
      isReady: function isReady() {
        if (!this.moduleName) return true;
        return canLoadModule(projectRoot, this.moduleName);
      },
    },
    {
      label: 'parcel-watcher',
      moduleName: resolveParcelWatcherPackage(),
      ownerModule: '@parcel/watcher',
      isReady: () => canLoadModule(projectRoot, '@parcel/watcher'),
    },
    {
      label: 'swc-core',
      moduleName: resolveSwcCorePackage(),
      ownerModule: '@swc/core',
      isReady: () => canLoadModule(projectRoot, '@swc/core'),
    },
    {
      label: 'tailwind-oxide',
      moduleName: resolveTailwindOxidePackage(),
      ownerModule: '@tailwindcss/oxide',
      isReady: () => canLoadModule(projectRoot, '@tailwindcss/oxide'),
    },
  ];

  for (const target of targets) {
    if (target.isReady()) {
      continue;
    }

    if (!target.moduleName) {
      console.warn(
        `[native-bindings] Unsupported runtime (${runtimeKey()}); skip ${target.label} install.`,
      );
      continue;
    }

    const version = resolveOptionalVersion(projectRoot, target.ownerModule, target.moduleName);
    console.log(
      `[native-bindings] Missing ${target.label} binding for ${runtimeKey()}, installing ${target.moduleName}@${version} ...`,
    );

    const ok = installPackage(projectRoot, target.moduleName, version);
    if (!ok || !target.isReady()) {
      console.error(
        `[native-bindings] Failed to install/load ${target.moduleName}@${version}. Please run "npm install --force ${target.moduleName}@${version}" in frontend and retry.`,
      );
      process.exit(1);
    }

    console.log(`[native-bindings] ${target.label} binding is ready.`);
  }
}

main();
