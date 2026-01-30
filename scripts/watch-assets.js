
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Go up one level from scripts/ to get project root
const PROJECT_ROOT = path.resolve(__dirname, '..');

const PATHS = {
    assetsSrc: path.join(PROJECT_ROOT, 'app/src/assets'),
    assetsDest: path.join(PROJECT_ROOT, 'app/public'), // Assets are copied to root of public usually as per build:assets
    routesSrc: path.join(PROJECT_ROOT, 'app/src/_routes.json'),
    routesDest: path.join(PROJECT_ROOT, 'app/public/_routes.json')
};

// Log helper with timestamp
const log = (msg) => console.log(`[\x1b[36mwatch:assets\x1b[0m] ${msg}`);

function copyFile(src, dest) {
    fs.copyFile(src, dest, (err) => {
        if (err) {
            console.error(`[\x1b[31merror\x1b[0m] Failed to copy ${path.basename(src)}:`, err);
        } else {
            log(`Updated ${path.basename(src)}`);
        }
    });
}

// Watch _routes.json
if (fs.existsSync(PATHS.routesSrc)) {
    log(`Watching ${PATHS.routesSrc}...`);
    fs.watch(PATHS.routesSrc, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
            copyFile(PATHS.routesSrc, PATHS.routesDest);
        }
    });
} else {
    console.warn(`[\x1b[33mwarn\x1b[0m] ${PATHS.routesSrc} not found, skipping.`);
}

// Watch assets folder
if (fs.existsSync(PATHS.assetsSrc)) {
    log(`Watching ${PATHS.assetsSrc}...`);
    fs.watch(PATHS.assetsSrc, (eventType, filename) => {
        if (filename) {
            // Ignore .DS_Store etc
            if (filename.startsWith('.')) return;

            const srcFile = path.join(PATHS.assetsSrc, filename);
            const destFile = path.join(PATHS.assetsDest, filename);

            // check if file still exists (handling deletions is tricky, but we can verify existence)
            if (fs.existsSync(srcFile)) {
                copyFile(srcFile, destFile);
            }
        }
    });
} else {
    console.warn(`[\x1b[33mwarn\x1b[0m] ${PATHS.assetsSrc} not found, skipping.`);
}
