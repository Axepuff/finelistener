const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Build variant configuration
// ---------------------------------------------------------------------------

const BUILD_VARIANT = process.env.BUILD_VARIANT || '';

// Build-assets layout (basenames become resource folder names):
//   build-assets/<variant>/whisper/            → resources/whisper
//   build-assets/<variant>/miniaudio-loopback/ → resources/miniaudio-loopback
//   build-assets/models/                       → resources/models
const buildAssetsDir = (variant, subdir) => path.resolve(__dirname, 'build-assets', variant, subdir);

const VARIANT_CONFIG = {
    'mac-arm64': {
        extraResource: [
            buildAssetsDir('mac-arm64', 'whisper'),
            path.resolve(__dirname, 'build-assets/models'),
        ],
        asarUnpack: [
            '**/node_modules/ffmpeg-static/**',
            '**/node_modules/audiotee/**',
        ],
        ignore: [
            /[\\/](?:whisper\.cpp)(?:[\\/]|$)/,
            /[\\/](?:models)(?:[\\/]|$)/,
            /[\\/](?:miniaudio-loopback)(?:[\\/]|$)/,
            /[\\/]out(?:[\\/]|$)/,
            /[\\/]build-assets(?:[\\/]|$)/,
            /[\\/]node_modules[\\/]application-loopback(?:[\\/]|$)/,
        ],
        makers: [
            { name: '@electron-forge/maker-dmg', config: {} },
            { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
        ],
    },
    'win-x64-gpu': {
        extraResource: [
            buildAssetsDir('win-x64-gpu', 'whisper'),
            path.resolve(__dirname, 'build-assets/models'),
            buildAssetsDir('win-x64-gpu', 'miniaudio-loopback'),
        ],
        asarUnpack: [
            '**/node_modules/ffmpeg-static/**',
            '**/node_modules/application-loopback/**',
        ],
        ignore: [
            /[\\/](?:whisper\.cpp)(?:[\\/]|$)/,
            /[\\/](?:models)(?:[\\/]|$)/,
            /[\\/](?:miniaudio-loopback)(?:[\\/]|$)/,
            /[\\/]out(?:[\\/]|$)/,
            /[\\/]build-assets(?:[\\/]|$)/,
            /[\\/]node_modules[\\/]audiotee(?:[\\/]|$)/,
        ],
        makers: [
            { name: '@electron-forge/maker-squirrel', config: {} },
            { name: '@electron-forge/maker-zip', platforms: ['win32'] },
        ],
    },
    'win-x64-cpu': {
        extraResource: [
            buildAssetsDir('win-x64-cpu', 'whisper'),
            path.resolve(__dirname, 'build-assets/models'),
            buildAssetsDir('win-x64-cpu', 'miniaudio-loopback'),
        ],
        asarUnpack: [
            '**/node_modules/ffmpeg-static/**',
            '**/node_modules/application-loopback/**',
        ],
        ignore: [
            /[\\/](?:whisper\.cpp)(?:[\\/]|$)/,
            /[\\/](?:models)(?:[\\/]|$)/,
            /[\\/](?:miniaudio-loopback)(?:[\\/]|$)/,
            /[\\/]out(?:[\\/]|$)/,
            /[\\/]build-assets(?:[\\/]|$)/,
            /[\\/]node_modules[\\/]audiotee(?:[\\/]|$)/,
        ],
        makers: [
            { name: '@electron-forge/maker-squirrel', config: {} },
            { name: '@electron-forge/maker-zip', platforms: ['win32'] },
        ],
    },
};

// Fall back to original dev-friendly config when no BUILD_VARIANT is set
const variantCfg = VARIANT_CONFIG[BUILD_VARIANT] || null;

const extraResource = variantCfg
    ? variantCfg.extraResource
    : [
        path.resolve(__dirname, 'whisper.cpp'),
        path.resolve(__dirname, 'miniaudio-loopback'),
        path.resolve(__dirname, 'models'),
    ];

const asarUnpackPatterns = variantCfg
    ? variantCfg.asarUnpack
    : [
        '**/node_modules/ffmpeg-static/**',
        '**/node_modules/audiotee/**',
        '**/node_modules/application-loopback/**',
    ];

const packagerIgnore = variantCfg
    ? variantCfg.ignore
    : [
        /[\\/](?:whisper\.cpp)(?:[\\/]|$)/,
        /[\\/](?:models)(?:[\\/]|$)/,
        /[\\/]out(?:[\\/]|$)/,
    ];

const makers = variantCfg
    ? variantCfg.makers
    : [
        { name: '@electron-forge/maker-squirrel', config: {} },
        { name: '@electron-forge/maker-zip', platforms: ['darwin', 'win32'] },
        { name: '@electron-forge/maker-deb', config: {} },
        { name: '@electron-forge/maker-rpm', config: {} },
    ];

if (BUILD_VARIANT) {
    console.log(`[forge config] BUILD_VARIANT=${BUILD_VARIANT}`);
}

// ---------------------------------------------------------------------------
// Code signing helpers (macOS)
// ---------------------------------------------------------------------------

const signTarget = (targetPath, args = []) => {
    const result = spawnSync('codesign', ['--force', '--sign', '-', ...args, targetPath], { encoding: 'utf8' });

    if (result.status !== 0) {
        console.warn('[forge postPackage] codesign failed for', targetPath, result.stderr || result.stdout);
    } else {
        console.log('[forge postPackage] codesign ok for', targetPath);
    }
};

/**
 * Find all Mach-O binaries inside a directory using the `file` command.
 * Returns paths sorted deepest-first so inner binaries are signed before outer ones.
 */
const findMachOFiles = (dir) => {
    const result = spawnSync('find', [dir, '-type', 'f'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

    if (result.status !== 0) return [];

    const files = result.stdout.trim().split('\n').filter(Boolean);
    const machOFiles = [];

    for (const filePath of files) {
        // Check known binary extensions first (fast path)
        if (/\.(dylib|so|node)$/.test(filePath)) {
            machOFiles.push(filePath);
            continue;
        }

        // For files without extension or executable files, use `file` command
        const ext = path.extname(filePath);

        if (!ext || ext === '.bin') {
            const fileResult = spawnSync('file', ['--brief', filePath], { encoding: 'utf8' });

            if (fileResult.stdout && fileResult.stdout.includes('Mach-O')) {
                machOFiles.push(filePath);
            }
        }
    }

    // Sort deepest paths first so we sign inside-out
    return machOFiles.sort((a, b) => b.split('/').length - a.split('/').length);
};

const signAppBundle = (appPath) => {
    if (!appPath || !fs.existsSync(appPath)) return;

    console.log('[forge postPackage] Signing app bundle:', appPath);

    // 1. Find and sign all Mach-O binaries inside the bundle (inside-out)
    const binaries = findMachOFiles(appPath);

    console.log(`[forge postPackage] Found ${binaries.length} Mach-O binaries to sign`);

    for (const bin of binaries) {
        signTarget(bin);
    }

    // 2. Sign any .framework bundles
    const frameworksDir = path.join(appPath, 'Contents', 'Frameworks');

    if (fs.existsSync(frameworksDir)) {
        const entries = fs.readdirSync(frameworksDir);

        for (const entry of entries) {
            const frameworkPath = path.join(frameworksDir, entry);

            if (entry.endsWith('.framework') || entry.endsWith('.app')) {
                signTarget(frameworkPath);
            }
        }
    }

    // 3. Sign the main app bundle last
    signTarget(appPath);
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

// ---------------------------------------------------------------------------
// Forge config
// ---------------------------------------------------------------------------

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
        extraResource,
        ignore: packagerIgnore,
    },
    rebuildConfig: {},
    makers,
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
            [FuseV1Options.EnableCookieEncryption]: false,
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
