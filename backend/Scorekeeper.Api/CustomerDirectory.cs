using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Scorekeeper.Core;
namespace Scorekeeper.Api;
// These confidential application credentials exist only on the API, never in web/mobile bundles.
public sealed class CustomerDirectory : ICustomerDirectory
{
 readonly HttpClient http=new(){Timeout=TimeSpan.FromSeconds(25)};
 readonly SemaphoreSlim gate=new(1,1);
 string? cachedToken;
 DateTimeOffset tokenExpires;
 public string TenantId {get;}=TokenVerifier.Required("AuthTenantId");
 string ClientId=>Environment.GetEnvironmentVariable("GraphClientId")??TokenVerifier.Required("AuthAudience");
 string? Secret=>Environment.GetEnvironmentVariable("GraphClientSecret");
 public bool IsConfigured=>Environment.GetEnvironmentVariable("AccountDeletionEnabled")=="true" && !string.IsNullOrWhiteSpace(Secret) && Guid.TryParse(ClientId,out _);
 async Task<string> Token()
 {
  if(!IsConfigured)throw new InvalidOperationException("Account deletion is not configured yet.");
  await gate.WaitAsync();
  try
  {
   if(cachedToken is not null&&tokenExpires>DateTimeOffset.UtcNow.AddMinutes(1))return cachedToken;
   using var body=new FormUrlEncodedContent(new Dictionary<string,string>{{"client_id",ClientId},{"client_secret",Secret!},{"grant_type","client_credentials"},{"scope","https://graph.microsoft.com/.default"}});
   using var result=await http.PostAsync($"https://login.microsoftonline.com/{Guid.Parse(TenantId):D}/oauth2/v2.0/token",body);
   if(!result.IsSuccessStatusCode)throw new HttpRequestException($"Customer-directory token request failed ({(int)result.StatusCode}).");
   using var json=JsonDocument.Parse(await result.Content.ReadAsStringAsync());
   cachedToken=json.RootElement.GetProperty("access_token").GetString()??throw new HttpRequestException("Directory did not return an access token.");
   tokenExpires=DateTimeOffset.UtcNow.AddSeconds(json.RootElement.GetProperty("expires_in").GetInt32());return cachedToken;
  }
  finally{gate.Release();}
 }
 async Task<HttpResponseMessage> Request(HttpMethod method,string path)
 {
  using var req=new HttpRequestMessage(method,"https://graph.microsoft.com/v1.0/"+path);
  req.Headers.Authorization=new AuthenticationHeaderValue("Bearer",await Token());
  return await http.SendAsync(req);
 }
 public async Task VerifyCustomer(Guid customerId)
 {
  using var response=await Request(HttpMethod.Get,$"users/{customerId:D}?$select=id,creationType,userType");
  if(response.StatusCode==HttpStatusCode.NotFound)return; // Identity already removed; deleting its own remaining data is safe.
  if(!response.IsSuccessStatusCode)throw new HttpRequestException($"Customer lookup failed ({(int)response.StatusCode}).");
  using var document=JsonDocument.Parse(await response.Content.ReadAsStringAsync());var user=document.RootElement;
  // Only local customer accounts are supported. Never target workforce/administrator accounts or a client-supplied ID.
  if(!user.TryGetProperty("creationType",out var creation)||creation.GetString()!="LocalAccount"||!user.TryGetProperty("userType",out var type)||type.GetString()!="Member")throw new ArgumentException("Only a customer account can be deleted from Scorekeeper.");
 }
 public async Task DeleteCustomer(Guid customerId)
 {
  using var response=await Request(HttpMethod.Delete,$"users/{customerId:D}");
  if(response.StatusCode is HttpStatusCode.NoContent or HttpStatusCode.NotFound)return;
  throw new HttpRequestException($"Customer deletion failed ({(int)response.StatusCode}).");
 }
}
