import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DESCRIPTION = 'This app records system audio for transcription.';
const DEV_APP_NAME = 'FineListener Dev.app';
const DEV_BUNDLE_ID = 'com.axepuff.finelistener.dev';

const fileExists = async (filePath) => {
    try {
        await fs.access(filePath);

        return true;
    } catch {
        return false;
    }
};

const runCodesign = (appPath) => {
    const result = spawnSync(
        'codesign',
        ['--force', '--deep', '--sign', '-', '-i', DEV_BUNDLE_ID, appPath],
        { encoding: 'utf8' },
    );

    if (result.status !== 0) {
        console.warn('[prepare-dev-macos-app] codesign failed:', (result.stderr || result.stdout || '').trim());
        return false;
    }

    console.log('[prepare-dev-macos-app] codesign ok.');
    return true;
};

const verifyCodesign = (appPath) => {
    const result = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], { encoding: 'utf8' });

    return result.status === 0;
};

const copyElectronApp = async (sourcePath, targetPath) => {
    const result = spawnSync('ditto', [sourcePath, targetPath], { encoding: 'utf8' });

    if (result.status !== 0) {
        throw new Error(`ditto failed: ${(result.stderr || result.stdout || '').trim()}`);
    }
};

const patchInfoPlist = async (plistPath) => {
    let content = await fs.readFile(plistPath, 'utf8');

    if (!content.includes('<plist')) {
        throw new Error('Unexpected Info.plist format (missing <plist>)');
    }

    const ensureKey = (key, value) => {
        const keyTag = `<key>${key}</key>`;
        const valueTag = `<string>${value}</string>`;

        if (content.includes(keyTag)) {
            content = content.replace(
                new RegExp(`<key>${key}<\\/key>\\s*<string>[^<]*<\\/string>`, 'm'),
                `${keyTag}\n\t${valueTag}`,
            );
            return;
        }

        content = content.replace('</dict>', `\t${keyTag}\n\t${valueTag}\n</dict>`);
    };

    ensureKey('CFBundleIdentifier', DEV_BUNDLE_ID);
    ensureKey('CFBundleDisplayName', 'FineListener Dev');
    ensureKey('CFBundleName', 'FineListener Dev');
    ensureKey('NSAudioCaptureUsageDescription', DESCRIPTION);

    await fs.writeFile(plistPath, content, 'utf8');
};

const main = async () => {
    if (process.platform !== 'darwin') {
        return;
    }

    const cwd = process.cwd();
    const sourceElectronApp = path.resolve(cwd, 'node_modules', 'electron', 'dist', 'Electron.app');

    if (!(await fileExists(sourceElectronApp))) {
        throw new Error(`Electron.app not found at ${sourceElectronApp}`);
    }

    const devRoot = path.resolve(cwd, 'out', 'dev');
    const devAppPath = path.resolve(devRoot, DEV_APP_NAME);

    await fs.mkdir(devRoot, { recursive: true });

    const recreate = async () => {
        await fs.rm(devAppPath, { recursive: true, force: true });
        console.log('[prepare-dev-macos-app] Creating dev app bundle (copy via ditto)...');
        await copyElectronApp(sourceElectronApp, devAppPath);
    };

    if (await fileExists(devAppPath)) {
        // Some copy methods break framework symlinks and make codesign impossible; self-heal.
        if (!verifyCodesign(devAppPath)) {
            console.warn('[prepare-dev-macos-app] Existing dev app failed codesign verify. Recreating...');
            await recreate();
        }
    } else {
        await recreate();
    }

    const plistPath = path.resolve(devAppPath, 'Contents', 'Info.plist');

    await patchInfoPlist(plistPath);

    const sourceAudiotee = path.resolve(cwd, 'node_modules', 'audiotee', 'bin', 'audiotee');
    const targetAudiotee = path.resolve(devAppPath, 'Contents', 'Resources', 'audiotee');

    if (!(await fileExists(sourceAudiotee))) {
        throw new Error(`audiotee binary not found at ${sourceAudiotee}`);
    }

    await fs.copyFile(sourceAudiotee, targetAudiotee);
    await fs.chmod(targetAudiotee, 0o755);

    runCodesign(devAppPath);

    if (!verifyCodesign(devAppPath)) {
        console.warn('[prepare-dev-macos-app] codesign verify failed after signing. Recreating once...');
        await recreate();
        await patchInfoPlist(plistPath);
        await fs.copyFile(sourceAudiotee, targetAudiotee);
        await fs.chmod(targetAudiotee, 0o755);
        runCodesign(devAppPath);
    }

    console.log('[prepare-dev-macos-app] dev app:', devAppPath);
};

await main();
