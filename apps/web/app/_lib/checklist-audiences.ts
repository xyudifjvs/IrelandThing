export const agentCanSee=(visibility:string)=>['agent','client'].includes(visibility);
export const clientCanSee=(visibility:string)=>['client_only','client'].includes(visibility);
export const audienceVisibility=(agent:boolean,client:boolean)=>agent?(client?'client':'agent'):(client?'client_only':'coordinator');
export const localAppointment=(value:string|null|undefined)=>{if(!value)return '';const d=new Date(value);return new Date(d.valueOf()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
