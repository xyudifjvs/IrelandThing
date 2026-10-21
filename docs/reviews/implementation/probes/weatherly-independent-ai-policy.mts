import {createRequire} from 'node:module';
const require=createRequire('/Users/carson/.codex/worktrees/weatherly-review/IrelandThing/package.json');
const {z}=require('zod');
const {generateStructured}=await import('/Users/carson/.codex/worktrees/weatherly-review/IrelandThing/packages/ai/src/gateway.ts');
let calls=0,body:any,url='';const fake:any=async(u:any,i:any)=>{calls++;url=String(u);body=JSON.parse(i.body);return Response.json({choices:[{message:{content:JSON.stringify({answer:'Synthetic answer'})}}],model:'synthetic/model',provider:'synthetic/zdr'});};
const data={purpose:'assistant_answer' as const,instructions:'Answer only synthetic input.',data:{note:'Synthetic evidence only'},schema:z.object({answer:z.string()})};
let blocked=false;delete process.env.OPENROUTER_API_KEY;try{await generateStructured(data,fake)}catch(e:any){blocked=e.code==='AI_UNAVAILABLE'}console.log(JSON.stringify({check:'Unconfigured gateway fails closed before fetch',pass:blocked&&calls===0}));
Object.assign(process.env,{OPENROUTER_API_KEY:'synthetic-not-a-key',OPENROUTER_MODEL:'synthetic/model:online',OPENROUTER_APPROVED_PROVIDERS:'synthetic/zdr',OPENROUTER_ZDR_APPROVED:'true'});
let privacyBlocked=false;try{await generateStructured(data,fake)}catch(e:any){privacyBlocked=e.code==='AI_UNAVAILABLE'}console.log(JSON.stringify({check:'Unverified account privacy fails closed',pass:privacyBlocked&&calls===0}));process.env.OPENROUTER_ACCOUNT_PRIVACY_VERIFIED='true';let variantRejected=false;try{await generateStructured(data,fake)}catch{variantRejected=true}
console.log(JSON.stringify({check:'Plugin-triggering model variant rejected',pass:variantRejected,calls}));
process.env.OPENROUTER_MODEL='synthetic/model'; await generateStructured(data,fake); console.log(JSON.stringify({check:'Explicit plugin disable boundary',pass:Array.isArray(body?.plugins)&&body.plugins.some((p:any)=>p.id==='web'&&p.enabled===false),plugins:body?.plugins||null,policy:body?.provider,url}));
