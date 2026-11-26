'use strict';
const argon2 = require('argon2');
// Argon2id, parameter OWASP (m=19MiB, t=2, p=1) — ramah RAM STB.
const OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
exports.hash = (pw) => argon2.hash(pw, OPTS);
exports.verify = async (hash, pw) => { try { return await argon2.verify(hash, pw); } catch { return false; } };
exports.validateStrength = (pw) => typeof pw === 'string' && pw.length >= 10;
