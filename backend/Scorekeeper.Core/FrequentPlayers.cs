namespace Scorekeeper.Core;
public record FrequentPlayerChange(Guid Id,string Kind,string Name,string? Original=null);
public static class FrequentPlayers
{
 public static string Clean(string? name){var value=name?.Trim();if(string.IsNullOrEmpty(value)||value.Length>30)throw new ArgumentException("Use a player name of 1–30 characters.");return value;}
 public static string[] Apply(string[] names,FrequentPlayerChange change)
 {
  if(change.Id==Guid.Empty||change.Kind is not ("add" or "remove" or "rename"))throw new ArgumentException("Invalid player change.");
  var name=Clean(change.Name);var original=change.Kind=="rename"?Clean(change.Original):name;
  var result=names.ToList();
  if(change.Kind is "remove" or "rename")result.RemoveAll(n=>string.Equals(n,original,StringComparison.OrdinalIgnoreCase));
  if(change.Kind!="remove"){
   var index=result.FindIndex(n=>string.Equals(n,name,StringComparison.OrdinalIgnoreCase));
   if(index<0)result.Add(name);else if(change.Kind=="rename")result[index]=name;
  }
  return result.ToArray();
 }
}
