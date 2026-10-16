// This only selects the callback screen. The MSAL SDK validates OAuth state
// and transports the response; application code never decodes or logs it.
export function isSilentCallback(embedded:boolean,hash:string,search:string){
 if(!embedded)return false;
 return [hash.replace(/^#/,''),search.replace(/^\?/,'')].some(value=>{
  const params=new URLSearchParams(value);
  return params.has('state')&&['code','error','ear_jwe'].some(key=>params.has(key));
 });
}

