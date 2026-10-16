import type {GameView} from '../../shared/api';
import {gameStandings} from '../../shared/standings';
export default function Standings({view}:{view:GameView}){
 const {players,margin,headline,detail}=gameStandings(view.game,view.totals);
 return <section className="standings" aria-label="Player standings"><div className="standings-heading"><h2>Standings</h2></div><div className="standings-summary" aria-label={margin}><p>{headline}</p><span>{detail}</span></div><ol className="standings-list">{players.map(({player,score,rank})=><li key={player.id} className={`standing-pill ${rank===1?'standing-leader':''}`} aria-label={`Rank ${rank}, ${player.name}, ${score} points`}><span className="standing-rank">{rank}</span><span className="standing-name" title={player.name}>{player.name}</span><strong>{score.toLocaleString()}</strong></li>)}</ol></section>;
}
