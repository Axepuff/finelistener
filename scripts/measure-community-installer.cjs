const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { utils } = require('@electron-forge/core');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const variant = process.argv[2];
if (!['win-x64-cpu', 'win-x64-gpu'].includes(variant)) {
    throw new Error('Usage: node scripts/measure-community-installer.cjs <win-x64-cpu|win-x64-gpu>');
}

process.env.BUILD_VARIANT = variant;
const config = require('../forge.config');
const resources = config.packagerConfig.extraResource;
const communityResource = path.resolve(root, 'build-assets', variant, 'community');
if (!resources.includes(communityResource) || !fs.existsSync(path.join(communityResource, 'component.json'))) {
    throw new Error('Prepare speaker assets before measuring the installer');
}

const outputRoot = path.resolve(root, 'build-assets', 'installer-measurements', variant, process.env.COMMUNITY_MEASUREMENT_RUN || String(Date.now()));
process.env.COMMUNITY_MEASUREMENT_RUN = path.basename(outputRoot);
const make = (name) => {
    const outputDir = path.join(outputRoot, name);
    const child = spawnSync(process.execPath, [__filename, variant, '--make-one', name], { cwd: root, stdio: 'inherit', env: process.env });
    if (child.status !== 0) throw new Error('Installer build failed: ' + name);
    const makerDir = path.join(outputDir, 'make', 'squirrel.windows', 'x64');
    const installer = fs.readdirSync(makerDir).find((file) => file.endsWith(' Setup.exe'));
    if (!installer) throw new Error(`No installer generated in ${makerDir}`);
    const asar = path.join(outputDir, 'Finelistener-win32-x64', 'resources', 'app.asar');
    return { bytes: fs.statSync(path.join(makerDir, installer)).size, asarHash: createHash('sha256').update(fs.readFileSync(asar)).digest('hex') };
};

const directoryBytes = (directory) => fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const target = path.join(directory, entry.name);
    return total + (entry.isDirectory() ? directoryBytes(target) : fs.statSync(target).size);
}, 0);

if (process.argv[3] === '--make-one') {
    const name = process.argv[4];
    utils.registerForgeConfigForDirectory(root, {
        ...config, packagerConfig: { ...config.packagerConfig,
            extraResource: name === 'baseline' ? resources.filter((resource) => resource !== communityResource) : resources },
    });
    const keepAlive = setInterval(() => {}, 1000);
    require('@electron-forge/core').api.make({ dir: root, platform: 'win32', arch: 'x64',
        interactive: true, overrideTargets: ['@electron-forge/maker-squirrel'], outDir: path.join(outputRoot, name) })
        .then(() => clearInterval(keepAlive), (error) => { console.error(error); clearInterval(keepAlive); process.exitCode = 1; });
} else {
try {
    const baseline = make('baseline');
    const withSpeakers = make('with-speakers');
    if (baseline.asarHash !== withSpeakers.asarHash) throw new Error('Application changed between paired builds; repeat from a stable checkout');
    const additionBytes = withSpeakers.bytes - baseline.bytes;
    const component = JSON.parse(fs.readFileSync(path.join(communityResource, 'component.json'), 'utf8'));
    console.log(JSON.stringify({ variant, baselineBytes: baseline.bytes, withSpeakersBytes: withSpeakers.bytes,
        additionBytes, bundledBytes: directoryBytes(communityResource),
        componentInstalledBytes: Object.values(component.files).reduce((sum, file) => sum + file.bytes, 0),
        componentDownloadBytes: component.bytes, withinLimit: additionBytes <= 200_000_000 }, null, 2));
    if (additionBytes > 200_000_000) process.exitCode = 1;
} catch (error) { console.error(error); process.exitCode = 1; }
}
