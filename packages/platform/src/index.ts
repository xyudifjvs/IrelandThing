import type {Request,Response,NextFunction,RequestHandler} from 'express';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
export type Role='coordinator'|'agent'|'client';
export interface Principal{id:string;email:string;name:string;role:Role;sessionId:string}
declare global {namespace Express {interface Request {principal?:Principal}}}
export class HttpError extends Error{constructor(public status:number,public code:string,message:string){super(message)}}
export const asyncHandler=(handler:(req:Request,res:Response,next:NextFunction)=>unknown):RequestHandler=>(req,res,next)=>{Promise.resolve(handler(req,res,next)).catch(next)};
export function principal(req:Request):Principal{if(!req.principal)throw new HttpError(401,'UNAUTHENTICATED','Please sign in to continue.');return req.principal}
export function assertCoordinator(actor:Principal){if(actor.role!=='coordinator')throw new HttpError(403,'FORBIDDEN','Only Ireland can perform this action.')}
export function hashToken(token:string){return createHash('sha256').update(token).digest('hex')}
export function newToken(){return randomBytes(32).toString('base64url')}
function encryptionKey(){const key=process.env.CREDENTIAL_ENCRYPTION_KEY;if(!key||Buffer.from(key,'base64').length!==32)throw new HttpError(503,'ENCRYPTION_NOT_CONFIGURED','Credential encryption is not configured.');return Buffer.from(key,'base64')}
export function encryptSecret(value:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.')}
export function decryptSecret(value:string){const [iv,tag,data]=value.split('.');if(!iv||!tag||!data)throw new Error('Invalid encrypted credential');const cipher=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv,'base64'));cipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8')}
export function validDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===value}
export function sanitizeError(error:unknown){return error instanceof HttpError?{error:{code:error.code,message:error.message}}:{error:{code:'INTERNAL_ERROR',message:'This action could not be completed. Please try again.'}}}
