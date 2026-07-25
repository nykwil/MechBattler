import { auditGameContent } from '../src/index.ts';

const audit = auditGameContent();
console.log(JSON.stringify(audit, null, 2));
if (!audit.ok) process.exitCode = 1;
