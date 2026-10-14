export type ScoreKey=string;
export function scoreKeyInput(value:string,key:ScoreKey){
 if(key==='backspace')return value.slice(0,-1);
 if(key==='sign')return value.startsWith('-')?value.slice(1):'-'+value;
 if(!/^\d$/.test(key))return value;
 const candidate=(value+key).replace(/^(-?)0+(?=\d)/,'$1');
 return candidate.replace('-','').length<=7&&Math.abs(Number(candidate))<=1000000?candidate:value;
}
