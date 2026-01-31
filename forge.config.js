const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const whisperResourceDir = path.resolve(__dirname, 'whisper.cpp');
const miniaudioLoopbackResourceDir = path.resolve(__dirname, 'miniaudio-loopback');
// Оставляем бинарные зависимости вне asar, чтобы можно было запускать их напрямую
const asarUnpackPatterns = [
    '**/node_modules/ffmpeg-static/**',
    '**/node_modules/audiotee/**',
    '**/node_modules/application-loopback/**',
];

// Не кладём whisper.cpp и другие тяжёлые артефакты внутрь app.asar, чтобы не дублировать ресурсы
const packagerIgnore = [
    /[\\/](?:whisper\.cpp)(?:[\\/]|$)/,
    /[\\/]out(?:[\\/]|$)/,
];

const signTarget = (targetPath, args = []) => {
    const result = spawnSync('codesign', ['--force', '--sign', '-', ...args, targetPath], { encoding: 'utf8' });

    if (result.status !== 0) {
        console.warn('[forge postPackage] codesign failed for', targetPath, result.stderr || result.stdout);
    } else {
        console.log('[forge postPackage] codesign ok for', targetPath);
    }
};

const signAppBundle = (appPath) => {
    if (!appPath || !fs.existsSync(appPath)) return;

    signTarget(appPath, ['--deep']);

    const audioteePath = path.resolve(
        appPath,
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'node_modules',
        'audiotee',
        'bin',
        'audiotee',
    );

    if (fs.existsSync(audioteePath)) {
        signTarget(audioteePath);
    }
};

const findAppBundles = (rootPath, depth = 4) => {
    if (!rootPath || depth < 0 || !fs.existsSync(rootPath)) return [];

    const stat = fs.statSync(rootPath);

    if (stat.isDirectory()) {
        if (rootPath.endsWith('.app')) {
            return [rootPath];
        }

        return fs.readdirSync(rootPath)
            .flatMap((entry) => findAppBundles(path.join(rootPath, entry), depth - 1));
    }

    return [];
};

module.exports = {
  packagerConfig: {
    appBundleId: 'com.axepuff.finelistener',
    name: 'Finelistener',
    asar: {
      unpack: asarUnpackPatterns,
    },
    extendInfo: {
      NSAudioCaptureUsageDescription: 'This app records system audio for transcription.',
    },
    // Ship whisper.cpp binaries/models alongside the packaged app
    extraResource: [whisperResourceDir, miniaudioLoopbackResourceDir],
    ignore: packagerIgnore,
  },
  rebuildConfig: {},
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {},
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin', 'win32'],
        },
        {
            name: '@electron-forge/maker-deb',
            config: {},
        },
        {
            name: '@electron-forge/maker-rpm',
            config: {},
        },
    ],
    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {},
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
    hooks: {
        preMake: async () => {
            const extraPaths = [
                '/opt/homebrew/bin', // Apple Silicon Homebrew
                '/usr/local/bin',    // Intel Homebrew
            ];
            const current = process.env.PATH || '';
            const merged = [...extraPaths, current].filter(Boolean).join(path.delimiter);
            process.env.PATH = merged;

            const which = (cmd) => {
                try {
                    const isWin = process.platform === 'win32';
                    const out = spawnSync(isWin ? 'where' : 'bash', isWin ? [cmd] : ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
                    return (out.stdout || '').trim();
                } catch {
                    return '';
                }
            };

            const hasWine = !!which('wine');
            const hasWine64 = !!which('wine64');
            const hasMono = !!which('mono');

            // If only wine64 exists, add a wine shim
            if (!hasWine && hasWine64 && process.platform !== 'win32') {
                const toolsDir = path.resolve(__dirname, 'build-tools');
                try { fs.mkdirSync(toolsDir, { recursive: true }); } catch { }
                const shimPath = path.join(toolsDir, 'wine');
                const shim = '#!/usr/bin/env bash\nexec wine64 "$@"\n';
                try {
                    fs.writeFileSync(shimPath, shim);
                    fs.chmodSync(shimPath, 0o755);
                    process.env.PATH = [toolsDir, process.env.PATH].join(path.delimiter);
                    console.log('[forge preMake] Added wine shim at', shimPath);
                } catch (e) {
                    console.warn('[forge preMake] Failed to create wine shim:', e);
                }
            }

            // If only wine exists, add a wine64 shim
            if (hasWine && !hasWine64 && process.platform !== 'win32') {
                const toolsDir = path.resolve(__dirname, 'build-tools');
                try { fs.mkdirSync(toolsDir, { recursive: true }); } catch { }
                const shimPath = path.join(toolsDir, 'wine64');
                const shim = '#!/usr/bin/env bash\nexec wine "$@"\n';
                try {
                    fs.writeFileSync(shimPath, shim);
                    fs.chmodSync(shimPath, 0o755);
                    process.env.PATH = [toolsDir, process.env.PATH].join(path.delimiter);
                    console.log('[forge preMake] Added wine64 shim at', shimPath);
                } catch (e) {
                    console.warn('[forge preMake] Failed to create wine64 shim:', e);
                }
            }

            console.log('[forge preMake] PATH =', process.env.PATH);
            console.log('[forge preMake] wine =', which('wine'));
            console.log('[forge preMake] wine64 =', which('wine64'));
            console.log('[forge preMake] mono =', which('mono'));
            if (!hasMono) {
                console.warn('[forge preMake] mono not found on PATH. maker-squirrel will fail without it.');
            }
        },
        postPackage: async (_config, options) => {
            if (process.platform !== 'darwin') return;

            const outputPaths = Array.isArray(options?.outputPaths) ? options.outputPaths : [];
            const appPaths = outputPaths.flatMap((outputPath) => findAppBundles(outputPath));

            if (!appPaths.length) {
                console.warn('[forge postPackage] No app bundles found to sign.');

                return;
            }

            appPaths.forEach(signAppBundle);
        },
    },
};
