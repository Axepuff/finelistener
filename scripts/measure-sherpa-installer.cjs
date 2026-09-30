const fs = require('node:fs');
const path = require('node:path');
const { api, utils } = require('@electron-forge/core');

const root = path.resolve(__dirname, '..');
const variant = process.argv[2];
if (!['win-x64-cpu', 'win-x64-gpu'].includes(variant)) {
    throw new Error('Usage: node scripts/measure-sherpa-installer.cjs <win-x64-cpu|win-x64-gpu>');
}

process.env.BUILD_VARIANT = variant;
const config = require('../forge.config');
const resources = config.packagerConfig.extraResource;
const sherpaResource = path.resolve(root, 'build-assets', variant, 'sherpa');
if (!resources.includes(sherpaResource) || !fs.existsSync(path.join(sherpaResource, 'asset-manifest.json'))) {
    throw new Error('Prepare speaker assets before measuring the installer');
}

const outputRoot = path.resolve(root, 'build-assets', 'installer-measurements', variant);
const make = async (name, extraResource) => {
    const outputDir = path.join(outputRoot, name);
    utils.registerForgeConfigForDirectory(root, {
        ...config,
        packagerConfig: { ...config.packagerConfig, extraResource },
    });
    try {
        await api.make({ dir: root, platform: 'win32', arch: 'x64',
            overrideTargets: ['@electron-forge/maker-squirrel'], outDir: outputDir });
    } finally {
        utils.unregisterForgeConfigForDirectory(root);
    }
    const makerDir = path.join(outputDir, 'make', 'squirrel.windows', 'x64');
    const installer = fs.readdirSync(makerDir).find((file) => file.endsWith(' Setup.exe'));
    if (!installer) throw new Error(`No installer generated in ${makerDir}`);
    return fs.statSync(path.join(makerDir, installer)).size;
};

const directoryBytes = (directory) => fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const target = path.join(directory, entry.name);
    return total + (entry.isDirectory() ? directoryBytes(target) : fs.statSync(target).size);
}, 0);

(async () => {
    const baselineBytes = await make('baseline', resources.filter((resource) => resource !== sherpaResource));
    const withSpeakersBytes = await make('with-speakers', resources);
    const additionBytes = withSpeakersBytes - baselineBytes;
    console.log(JSON.stringify({ variant, baselineBytes, withSpeakersBytes,
        additionBytes, installedBytes: directoryBytes(sherpaResource),
        withinLimit: additionBytes <= 200_000_000 }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
