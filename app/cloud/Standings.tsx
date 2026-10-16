import type {GameView} from '../../shared/api';
import {gameStandings} from '../../shared/standings';
export default function Standings({view}:{view:GameView}){
 const {players,margin,leadLabel}=gameStandings(view.game,view.totals);
 return <section className="standings" aria-label="Player standings"><div className="standings-heading"><h2>Standings</h2><p aria-label={margin}>{leadLabel}</p></div><ol className="standings-list">{players.map(({player,score,rank})=><li key={player.id} className={`standing-pill ${rank===1?'standing-leader':''}`} aria-label={`Rank ${rank}, ${player.name}, ${score} points`}><span className="standing-rank">{rank}</span><span className="standing-name" title={player.name}>{player.name}</span><strong>{score.toLocaleString()}</strong></li>)}</ol></section>;
}
