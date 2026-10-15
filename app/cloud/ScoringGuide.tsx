import type {ScoringGuide as Guide} from "../../shared/presets";
import styles from "./ScoringGuide.module.css";

export default function ScoringGuide({guide}:{guide?:Guide}){
 if(!guide)return null;
 return <details className={styles.guide}>
  <summary>Scoring guide<span className={styles.icon} aria-hidden="true"/></summary>
  <div className={styles.body}>
   <p>{guide.description}</p>
   <dl>{guide.rows.map(row=><div key={row.label}><dt>{row.label}</dt><dd>{row.points} <span>points</span></dd></div>)}</dl>
  </div>
 </details>;
}
