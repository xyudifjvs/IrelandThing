import 'dotenv/config';
import {PrismaClient,Prisma} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
const url=process.env.DATABASE_URL;
if(!url) throw new Error('DATABASE_URL is required; no in-memory database fallback is permitted.');
const globalDb=globalThis as unknown as {weatherlyPrisma?:PrismaClient};
export const prisma=globalDb.weatherlyPrisma || new PrismaClient({adapter:new PrismaPg({connectionString:url,max:8})});
if(process.env.NODE_ENV!=='production') globalDb.weatherlyPrisma=prisma;
export {Prisma};
