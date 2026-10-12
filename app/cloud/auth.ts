import { PublicClientApplication } from "@azure/msal-browser";
export const cloudConfig={api:process.env.NEXT_PUBLIC_SCOREKEEPER_API_URL||"",authority:process.env.NEXT_PUBLIC_SCOREKEEPER_AUTHORITY||"",clientId:process.env.NEXT_PUBLIC_SCOREKEEPER_WEB_CLIENT_ID||"",scope:process.env.NEXT_PUBLIC_SCOREKEEPER_SCOPE||""};
export const cloudEnabled=Object.values(cloudConfig).every(Boolean);
let client:Promise<PublicClientApplication>|undefined;
export function auth(){return client??= (async()=>{const instance=new PublicClientApplication({auth:{clientId:cloudConfig.clientId,authority:cloudConfig.authority,knownAuthorities:[new URL(cloudConfig.authority).hostname],redirectUri:window.location.origin+"/"},cache:{cacheLocation:"sessionStorage"}});await instance.initialize();const result=await instance.handleRedirectPromise();if(result?.account)instance.setActiveAccount(result.account);else instance.setActiveAccount(instance.getAllAccounts()[0]||null);return instance})()}
export async function token(){const instance=await auth();const account=instance.getActiveAccount();if(!account)throw new Error("Sign in to continue.");return(await instance.acquireTokenSilent({scopes:[cloudConfig.scope],account})).accessToken}
export async function signIn(){await(await auth()).loginRedirect({scopes:[cloudConfig.scope]})}
export async function signOut(){await(await auth()).logoutRedirect({postLogoutRedirectUri:window.location.origin+"/"})}
