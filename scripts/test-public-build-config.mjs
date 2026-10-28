import assert from 'node:assert/strict';
import {publicBuildConfig,publicBuildConfigKeys} from './public-build-config.mjs';

const production=publicBuildConfig({});
assert.deepEqual(Object.keys(production),publicBuildConfigKeys);
assert.ok(publicBuildConfigKeys.every(key=>production[key]),'production web auth/API settings must remain available when the build environment is empty');
assert.equal(Object.values(production).every(Boolean),true,'empty build variables must not produce a guest-only production bundle');

const explicit=publicBuildConfig({NEXT_PUBLIC_SCOREKEEPER_WEB_CLIENT_ID:'test-client-id'},'# example\nNEXT_PUBLIC_SCOREKEEPER_WEB_CLIENT_ID=example-client-id\nNEXT_PUBLIC_SCOREKEEPER_API_URL=https://example.test/api');
assert.equal(explicit.NEXT_PUBLIC_SCOREKEEPER_WEB_CLIENT_ID,'test-client-id','explicit build variables take precedence over the example');
assert.equal(explicit.NEXT_PUBLIC_SCOREKEEPER_API_URL,'https://example.test/api','missing explicit variables fall back to the public example config');

const incomplete=publicBuildConfig({},'# no public config');
assert.ok(publicBuildConfigKeys.every(key=>incomplete[key]===''),'guest mode remains available only when no public build config is present');
console.log('Public web build config: explicit environment precedence and production sign-in fallback passed.');
