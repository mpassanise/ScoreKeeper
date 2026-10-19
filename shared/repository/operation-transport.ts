import {ApiError,ScorekeeperApi} from '../api';
import type {DeliveryScope,DeliveryTransport} from './game-delivery';
/** One token per pass, verified through /account before any operation is sent.
 * A 401 pauses the pass; this adapter never silently swaps credentials mid-queue. */
export function createOperationTransport(base:string,getToken:(profileId:string,signal:AbortSignal)=>Promise<string>,scope:Pick<DeliveryScope,'profileId'|'assert'>):DeliveryTransport{
 return {async open(signal){
  await scope.assert();if(signal.aborted)throw new ApiError(499,'Delivery cancelled.','REQUEST_CANCELLED');
  const token=await getToken(scope.profileId,signal);
  await scope.assert();if(signal.aborted)throw new ApiError(499,'Delivery cancelled.','REQUEST_CANCELLED');
  const api=(requestSignal:AbortSignal)=>new ScorekeeperApi(base,async()=>{await scope.assert();if(requestSignal.aborted)throw new ApiError(499,'Delivery cancelled.','REQUEST_CANCELLED');return token},{signal:requestSignal,readAttempts:1});
  return {account:s=>api(s).account(),operation:(wire,s)=>api(s).operation(wire),get:(id,s)=>api(s).get(id)};
 }};
}
