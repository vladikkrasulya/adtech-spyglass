'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'packages/core/source-map.js');
const target = path.join(root, 'public/modules/inspector/source-map.js');

fs.copyFileSync(source, target);
process.stdout.write(`synced ${path.relative(root, target)}\n`);
