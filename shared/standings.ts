import type {Game,Player} from './api';
export function gameStandings(game:Pick<Game,'players'|'winner'|'finished'>,totals:Record<string,number>){
 const ordered=game.players.map(player=>({player,score:totals[player.id]??0})).sort((a,b)=>game.winner==='high'?b.score-a.score:a.score-b.score);
 let rank=0;
 const players=ordered.map((entry,index)=>{if(index===0||entry.score!==ordered[index-1].score)rank=index+1;return {...entry,rank}});
 const leaders=players.filter(p=>p.rank===1),gap=players.length>1?Math.abs(players[0].score-players[1].score):0;
 const margin=players.length<2?'':leaders.length>1?`Tied for ${game.finished?'first':'the lead'} · ${leaders.length} players`:`${players[0].player.name} ${game.finished?'won':'leads'} by ${gap.toLocaleString()} ${gap===1?'point':'points'}`;
 return {players,margin};
}
