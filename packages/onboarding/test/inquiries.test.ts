import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@weatherly/db";
import { createInquiry } from "../src/index";
const ids:string[]=[];
afterAll(async()=>{await prisma.inquiry.deleteMany({where:{id:{in:ids}}});});
describe("supplied public onboarding forms",()=>{
 it("saves the email-only information request once without claiming a sent email",async()=>{
   const request={requestId:randomUUID(),email:"synthetic-info@example.test",kind:"information",payload:{}};
   const saved=await createInquiry(request);ids.push(saved.id);
   expect(saved.status).toBe("received");expect(await createInquiry(request)).toEqual(saved);
   const record=await prisma.inquiry.findUniqueOrThrow({where:{id:saved.id}});expect(record.name).toBe("");expect(record.status).toBe("new");
   await expect(createInquiry({...request,email:"changed@example.test"})).rejects.toMatchObject({code:"INQUIRY_CONFLICT"});
 });
 it("keeps service-agreement inputs structured and requires the applicant name",async()=>{
   const request={requestId:randomUUID(),name:"Synthetic Agent",email:"synthetic-agreement@example.test",kind:"information",payload:{requestType:"service_agreement",brokerage:"Howard Hanna",team:"Synthetic Team",officeAddress:"123 Synthetic Office Lane"}};
   const saved=await createInquiry(request);ids.push(saved.id);
   expect((await prisma.inquiry.findUniqueOrThrow({where:{id:saved.id}})).payload).toEqual(request.payload);
   await expect(createInquiry({...request,requestId:randomUUID(),name:""})).rejects.toThrow();
   await expect(createInquiry({...request,requestId:randomUUID(),payload:{...request.payload,brokerage:"Other brokerage"}})).rejects.toThrow();
 });
 it("retains name and meeting-time validation on the other public forms",async()=>{
   await expect(createInquiry({email:"synthetic@example.test",kind:"contact",payload:{}})).rejects.toThrow();
   await expect(createInquiry({name:"Synthetic",email:"synthetic@example.test",kind:"meeting",payload:{}})).rejects.toThrow();
 });
});
