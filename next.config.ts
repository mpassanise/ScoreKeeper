import type { NextConfig } from "next";
const nextConfig: NextConfig = {
 async headers(){return [{
  // The registered root also receives OAuth callbacks in a hidden frame.
  // Do not cache that document or forward its URL as a referrer.
  source:'/',
  headers:[{key:'Cache-Control',value:'no-store'},{key:'Referrer-Policy',value:'no-referrer'}]
 }]}
};
export default nextConfig;

