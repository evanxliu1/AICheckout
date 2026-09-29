import { resolve } from 'node:path';
import { packageExtension } from './release-package.mjs';

const result = packageExtension(resolve('dist'), resolve('package.json'), resolve('artifacts'));
console.log(`Packaged ${result.artifact}\nSHA-256 ${result.sha256}\nInventory ${result.inventory}`);
