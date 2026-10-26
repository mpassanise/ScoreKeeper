/** Explicit chrome tokens: header text must not inherit the generic score accent. */
export function gameChromeColors(dark:boolean){
 return dark
  ?{header:'#12343e',title:'#ffffff',detail:'#c4d9df',accent:'#9bd7dc',surface:'#19292f',border:'#365059'}
  :{header:'#e8f0f1',title:'#17252a',detail:'#385a61',accent:'#226b73',surface:'#ffffff',border:'#dce5e7'};
}
