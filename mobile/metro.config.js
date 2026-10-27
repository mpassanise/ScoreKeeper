const {getDefaultConfig}=require('expo/metro-config');
const path=require('path');
const config=getDefaultConfig(__dirname);
config.watchFolders=[path.resolve(__dirname,'../shared')];
// Shared hooks must use this app's React, even when web dependencies exist.
config.resolver.nodeModulesPaths=[path.resolve(__dirname,'node_modules')];
const resolveRequest=config.resolver.resolveRequest;
config.resolver.resolveRequest=(context,moduleName,platform)=>{
 if(moduleName==='react'||moduleName.startsWith('react/'))return context.resolveRequest(context,require.resolve(moduleName,{paths:[__dirname]}),platform);
 return (resolveRequest??context.resolveRequest)(context,moduleName,platform);
};
module.exports=config;
