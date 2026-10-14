export type DragRectangle={index:number;x:number;y:number;width:number;height:number};
/** Resolve the drop slot from the moving player's centre, independent of handle position. */
export function dragTarget(rectangles:DragRectangle[],index:number,dx:number,dy:number){
 const origin=rectangles.find(r=>r.index===index);if(!origin)return index;
 const x=origin.x+origin.width/2+dx,y=origin.y+origin.height/2+dy;
 let target=index,distance=Infinity;
 for(const r of rectangles){const d=Math.hypot(x-r.x-r.width/2,y-r.y-r.height/2);if(d<distance){distance=d;target=r.index}}
 return target;
}
