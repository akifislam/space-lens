const test = require('node:test');
const assert = require('node:assert/strict');
test('runtime has required web APIs', () => { assert.equal(typeof fetch, 'function'); assert.ok(Number(process.versions.node.split('.')[0]) >= 18); });
