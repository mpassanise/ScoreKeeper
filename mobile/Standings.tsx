import {ScrollView,StyleSheet,Text,View} from 'react-native';
import type {GameView} from '../shared/api';
import {gameStandings} from '../shared/standings';
import {useThemeStyles} from './Theme';
export default function Standings({view}:{view:GameView}){
 const s=useThemeStyles(styles),{players,margin,headline,detail}=gameStandings(view.game,view.totals);
 return <View style={s.section}><Text accessibilityRole="header" style={s.title}>Standings</Text><View accessible accessibilityLabel={margin} style={s.summary}><Text style={s.headline}>{headline}</Text><Text style={s.detail}>{detail}</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pills}>{players.map(({player,score,rank})=><View key={player.id} accessible accessibilityLabel={`Rank ${rank}, ${player.name}, ${score} points`} style={[s.pill,rank===1&&s.leader]}><Text style={s.rank}>{rank}</Text><Text numberOfLines={1} style={s.name}>{player.name}</Text><Text style={s.points}>{score.toLocaleString()}</Text></View>)}</ScrollView></View>;
}
const styles=StyleSheet.create({section:{gap:8},title:{fontSize:12,fontWeight:'600',color:'#62777d'},summary:{flexDirection:'row',flexWrap:'wrap',alignItems:'baseline',gap:8},headline:{fontSize:20,lineHeight:26,fontWeight:'700',color:'#17252a',flexShrink:1},detail:{fontSize:14,fontWeight:'600',color:'#226b73'},pills:{gap:8,paddingBottom:4},pill:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,paddingVertical:9,borderRadius:24,backgroundColor:'#e8f0f1',maxWidth:240},leader:{backgroundColor:'#edf8f5'},rank:{fontSize:11,fontWeight:'700',color:'#62777d'},name:{fontSize:14,fontWeight:'600',color:'#17252a',flexShrink:1},points:{fontSize:17,fontWeight:'700',fontVariant:['tabular-nums'],color:'#226b73'}});
