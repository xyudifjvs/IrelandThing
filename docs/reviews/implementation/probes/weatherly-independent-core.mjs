import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire('/Users/carson/.codex/worktrees/weatherly-review/IrelandThing/package.json');
const pg=require('pg');
const {hashPassword}=await import(pathToFileURL(require.resolve('better-auth/crypto')).href);
const db=new pg.Client({connectionString:'postgresql://weatherly:weatherly_local@127.0.0.1:55432/weatherly_independent_review'});await db.connect();
const pw='Weatherly-Local-2026!';const hashed=await hashPassword(pw);
for(const [id,role] of [['checker-agent2','agent'],['checker-client2','client']]){await db.query('INSERT INTO "User"(id,name,email,role,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,$3,true,now(),now()) ON CONFLICT(id) DO NOTHING',[id,id+'@example.test',role]);await db.query('INSERT INTO "Account"(id,"accountId","userId","providerId",password,"createdAt","updatedAt") VALUES($1,$2,$2,$3,$4,now(),now()) ON CONFLICT(id) DO NOTHING',[id+'-credential',id,'credential',hashed]);}
const base='http://127.0.0.1:4100';const log=[];let failures=0;
function check(name,ok,info={}){log.push({name,result:ok?'PASS':'FAIL',...info});if(!ok)failures++;}
async function req(path,cookie='',method='GET',body){const r=await fetch(base+path,{method,headers:{Origin:'http://127.0.0.1:3100',...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={raw:text.slice(0,200)}}return {status:r.status,data,headers:r.headers};}
async function login(email){const r=await req('/api/auth/sign-in/email','','POST',{email,password:pw});if(r.status!==200)throw new Error('Synthetic login failed '+email+' '+r.status+' '+JSON.stringify(r.data.error||r.data.message));return r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}
check('Unauthenticated matter list denied',(await req('/api/v1/matters')).status===401);
const owner=await login('ireland@example.test'),agent=await login('alex.agent@example.test'),client=await login('avery.client@example.test'),other=await login('checker-agent2@example.test');
const seeded=(await req('/api/v1/matters',owner)).data;check('Coordinator sees all three seeded matters',['demo-oak','demo-river','demo-maple'].every(id=>seeded.some(m=>m.id===id)));
check('Unrelated agent sees zero matters',(await req('/api/v1/matters',other)).data.length===0);
check('Unrelated agent direct matter denied',(await req('/api/v1/matters/demo-oak',other)).status===404);
const cp=await req('/api/v1/matters/demo-oak',client);check('Client narrow projection',cp.status===200&&!('details'in cp.data)&&!('participants'in cp.data)&&cp.data.notes.length===0&&cp.data.tasks.every(t=>t.visibility==='client'));
check('Client cannot see unrelated seeded file',(await req('/api/v1/matters/demo-maple',client)).status===404);
check('Agent cannot read private coordinator activity',(await req('/api/v1/matters/demo-oak/activity',agent)).status===403);
check('Client cannot create intake',(await req('/api/v1/intakes/drafts',client,'POST',{payload:{}})).status===403);
check('Profile role escalation rejected',(await req('/api/v1/profile',agent,'PATCH',{role:'coordinator'})).status===422);
const created=await req('/api/v1/matters',owner,'POST',{title:'Independent review listing',propertyAddress:'1 Synthetic Review Lane',side:'seller',packageCode:'full_listing',agentId:'agent-local'});const mid=created.data.id;check('Coordinator creates full listing',created.status===201&&created.data.stage==='listing');
const races=await Promise.all([req('/api/v1/matters/'+mid,owner,'PATCH',{expectedRevision:1,title:'RevisionA'}),req('/api/v1/matters/'+mid,owner,'PATCH',{expectedRevision:1,title:'RevisionB'})]);check('Concurrent same-revision updates have one winner',races.map(r=>r.status).sort().join(',')==='200,409',{statuses:races.map(r=>r.status)});
const now=(await req('/api/v1/matters/'+mid,owner)).data;const transitioned=await req('/api/v1/matters/'+mid,owner,'PATCH',{expectedRevision:now.revision,stage:'under_contract'});check('Listing transition preserves ID',transitioned.status===200&&transitioned.data.id===mid&&transitioned.data.stage==='under_contract');
const badAgreement=await req('/api/v1/onboarding/agreements',owner,'POST',{userId:'checker-agent2',version:'independent-evidence-test',status:'approved'});check('Approved agreement without signed evidence rejected',badAgreement.status===422,{status:badAgreement.status});
const payload={packageCode:'full_listing',side:'seller',propertyAddress:'2 Synthetic Review Lane',purchaseType:'cash',contractSource:'not_yet_executed',documentIds:[],clients:[{name:'Synthetic Seller',email:'seller@example.test',phone:'555-0100'}],directContact:'through_agent',title:{choice:'mls'},hoa:'none',priorPolicy:'not_applicable',broker:{name:'Synthetic Broker',email:'broker@example.test',pre1978:false,ownChecklist:false},notes:'Independent probe only',gift:{requested:false}};
const draft=await req('/api/v1/intakes/drafts',agent,'POST',{payload});const did=draft.data.id;
const submissions=await Promise.all([req('/api/v1/intakes/drafts/'+did+'/submit',agent,'POST',{expectedRevision:1,idempotencyKey:'checker-idempotency-'+did}),req('/api/v1/intakes/drafts/'+did+'/submit',agent,'POST',{expectedRevision:1,idempotencyKey:'checker-idempotency-'+did})]);check('Concurrent identical intake submissions return same matter',submissions.every(r=>r.status===200)&&submissions[0].data.matter.id===submissions[1].data.matter.id,{statuses:submissions.map(r=>r.status)});
const records=await db.query('SELECT count(*)::int n FROM "IntakeSubmission" WHERE "draftId"=$1',[did]);check('Exactly one persisted intake submission',records.rows[0].n===1);
const mismatch=await req('/api/v1/intakes/drafts/'+did+'/submit',agent,'POST',{expectedRevision:1,idempotencyKey:'other-key-'+did});check('Different key cannot resubmit immutable intake',mismatch.status===409);
const session=await req('/api/v1/session',other);const revoke=await req('/api/v1/sessions/revoke',other,'POST',{sessionId:session.data.session.id});check('Session revoke immediately blocks API',revoke.status===200&&(await req('/api/v1/matters',other)).status===401);
await db.end();console.log(JSON.stringify({candidate:'2859d65',checks:log.length,failures,results:log},null,2));
