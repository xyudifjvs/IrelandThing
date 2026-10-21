import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const matrix=JSON.parse(await readFile('infra/railway/services.json','utf8'));
assert.equal(matrix.status,'prepared-not-deployed');
for(const name of ['api','worker'])assert.equal(matrix.services[name].publicNetworking,false);
assert.equal(matrix.services.postgres.publicNetworking,false);assert.equal(matrix.services.documents.publicNetworking,false);
for(const name of ['api','worker','web']){const file=await readFile(matrix.services[name].dockerfile,'utf8');assert.ok(!file.includes('db:seed'),'Release image must never automatically seed users.');assert.ok(file.includes('USER node'),'Application runtime must be unprivileged.');assert.ok(file.includes('HEALTHCHECK'),'Runtime readiness probe required.');const ignore=await readFile(matrix.services[name].dockerfile+'.dockerignore','utf8');assert.ok(ignore.includes('**/.env'),'Secrets must be excluded from build context.');}
console.log('Deployment safeguards passed: no automatic seed, private internal services, non-root runtimes, health probes and secret exclusions.');
