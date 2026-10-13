// Allow unfinished entry (empty or '-') while typing; submission still requires an integer.
// Reject invalid pasted text instead of silently changing values such as 12.5 to 125.
export function isScoreInput(value:string):boolean{return /^-?[0-9]*$/.test(value)}
