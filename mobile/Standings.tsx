import {ScrollView,StyleSheet,Text,View} from 'react-native';
import type {GameView} from '../shared/api';
import {gameStandings} from '../shared/standings';
import {useThemeStyles} from './Theme';
export default function Standings({view}:{view:GameView}){
 const s=useThemeStyles(styles),{players,margin,leadLabel}=gameStandings(view.game,view.totals);
 return <View style={s.section}><View style={s.header}><Text accessibilityRole="header" style={s.title}>Standings</Text><Text accessibilityLabel={margin} style={s.margin}>{leadLabel}</Text></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pills}>{players.map(({player,score,rank})=><View key={player.id} accessible accessibilityLabel={`Rank ${rank}, ${player.name}, ${score} points`} style={[s.pill,rank===1&&s.leader]}><Text style={s.rank}>{rank}</Text><Text numberOfLines={1} style={s.name}>{player.name}</Text><Text style={s.points}>{score.toLocaleString()}</Text></View>)}</ScrollView></View>;
}
const styles=StyleSheet.create({section:{gap:10},header:{flexDirection:'row',flexWrap:'wrap',alignItems:'baseline',justifyContent:'space-between',gap:8},title:{fontSize:15,lineHeight:22,fontWeight:'600',color:'#62777d'},margin:{fontSize:15,lineHeight:22,color:'#62777d'},pills:{gap:8,paddingBottom:4},pill:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:14,paddingVertical:10,borderRadius:22,backgroundColor:'#e8f0f1',maxWidth:260},leader:{backgroundColor:'#edf8f5'},rank:{fontSize:15,lineHeight:22,color:'#62777d',fontVariant:['tabular-nums']},name:{fontSize:15,lineHeight:22,color:'#17252a',flexShrink:1},points:{fontSize:15,lineHeight:22,fontWeight:'700',fontVariant:['tabular-nums'],color:'#17252a'}});
