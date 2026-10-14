/** Button surfaces and labels are paired so a secondary button never inherits primary text. */
export function buttonColors(dark:boolean,secondary:boolean){
 if(!secondary)return {background:'#d4e965',text:'#123f4a'};
 return dark?{background:'#243b43',text:'#c4d9df'}:{background:'#e8f0f1',text:'#123f4a'};
}
