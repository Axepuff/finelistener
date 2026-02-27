import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const DEV_BUNDLE_ID = 'com.axepuff.finelistener.dev';

const runSync = (cmd, args) => {
    const result = spawnSync(cmd, args, { stdio: 'inherit' });

    if (result.error) {
        // eslint-disable-next-line no-console
        console.error(`[dev-electron] Failed to run ${cmd}:`, result.error);
        process.exit(1);
    }

    // spawnSync uses `null` when terminated by a signal
    const status = typeof result.status === 'number' ? result.status : 1;

    if (status !== 0) {
        process.exit(status);
    }
};

const cwd = process.cwd();

// Keep this dev flow self-contained so `npm run dev` works on macOS with TCC permissions.
if (process.platform === 'darwin') {
    runSync('node', [path.resolve(cwd, 'scripts', 'prepare-dev-macos-app.mjs')]);
    runSync('npm', ['run', 'build:electron']);

    const electronApp = path.resolve(cwd, 'out', 'dev', 'FineListener Dev.app');
    const tmp = os.tmpdir();
    const stdoutPath = path.resolve(tmp, 'finelistener-electron-dev.stdout.log');
    const stderrPath = path.resolve(tmp, 'finelistener-electron-dev.stderr.log');

    const quitDevApp = () => {
        try {
            spawnSync(
                'osascript',
                ['-e', `tell application id "${DEV_BUNDLE_ID}" to quit`],
                { stdio: 'ignore' },
            );
        } catch {
            // ignore quit errors (e.g. app not running)
        }
    };

    let shuttingDown = false;
    const handleShutdownSignal = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log(`[dev-electron] Received ${signal}, quitting app...`);
        quitDevApp();
    };

    // When you stop `npm run dev` (Ctrl+C), also quit the launched macOS app bundle.
    process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
    process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));

    // Launch through LaunchServices so macOS can show TCC prompts / list the app in privacy settings.
    console.log('[dev-electron] stdout log:', stdoutPath);
    console.log('[dev-electron] stderr log:', stderrPath);
    const openProc = spawn('open', [
        '-n',
        '-a',
        electronApp,
        '-W',
        '-o',
        stdoutPath,
        '--stderr',
        stderrPath,
        '--env',
        'ELECTRON_ENABLE_LOGGING=1',
        '--env',
        'ELECTRON_ENABLE_STACK_DUMPING=1',
        '--env',
        `FINELISTENER_DEV_ROOT=${cwd}`,
        '--args',
        cwd,
    ], { stdio: 'inherit' });

    openProc.on('exit', (code, signal) => {
        if (signal) {
            process.exit(0);
        }
        process.exit(typeof code === 'number' ? code : 0);
    });
} else {
    runSync('npm', ['run', 'build:electron']);
    runSync('electron', [cwd]);
}
