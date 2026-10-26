import {countdownProgress} from './scoring';
import type {Game,Player} from './api';
export function gameStandings(game:Pick<Game,'players'|'winner'|'finished'>&Partial<Pick<Game,'entries'|'startingScore'|'exactZero'>>,totals:Record<string,number>){
 const zeroOrder=game.winner==='zero'&&game.entries?countdownProgress(game as Game).zeroOrder:[];
 const ordered=game.players.map(player=>({player,score:totals[player.id]??0})).sort((a,b)=>game.winner==='high'?b.score-a.score:a.score-b.score||(game.winner==='zero'&&a.score===0?zeroOrder.indexOf(a.player.id)-zeroOrder.indexOf(b.player.id):0));
 let rank=0;
 const players=ordered.map((entry,index)=>{if(index===0||entry.score!==ordered[index-1].score||game.winner==='zero'&&entry.score===0)rank=index+1;return {...entry,rank}});
 const leaders=players.filter(p=>p.rank===1),gap=players.length>1?Math.abs(players[0].score-players[1].score):0;
 const margin=players.length<2?'':leaders.length>1?`Tied for ${game.finished?'first':'the lead'} · ${leaders.length} players`:`${players[0].player.name} ${game.finished?'won':'leads'} by ${gap.toLocaleString()} ${gap===1?'point':'points'}`;
 const headline=players.length<2?'':leaders.length>1?(game.finished?'Tied for first':'Tied for the lead'):`${players[0].player.name} ${game.finished?'won':'leads'}`;
 const detail=players.length<2?'':leaders.length>1?`${leaders.length} players`:`${gap.toLocaleString()} ${gap===1?'point':'points'} ahead`;
 const leadLabel=leaders.length>1?(game.finished?'Tied for first':'Tied for the lead'):detail;
 if(game.winner==='zero'&&players[0]?.score===0){const text=`${players[0].player.name} ${game.finished?'won':'reached zero first'}`;return {players,margin:text,headline:text,detail:'0 remaining',leadLabel:game.finished?'First to zero':'Zero reached · finish round'}}
 if(game.winner==='zero'&&game.finished)return {players,margin:'Finished before anyone reached zero',headline:'No player reached zero',detail:'No winner',leadLabel:'No winner'};
 return {players,margin,headline,detail,leadLabel};
}
