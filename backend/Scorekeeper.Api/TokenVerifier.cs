using System.IdentityModel.Tokens.Jwt;
using HttpRequestData = Microsoft.Azure.Functions.Worker.Http.HttpRequestData;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
namespace Scorekeeper.Api;
public sealed class TokenVerifier
{
 readonly ConfigurationManager<OpenIdConnectConfiguration> manager;
 readonly string tenant, audience, scope;
 public TokenVerifier()
 {
  var authority=Required("AuthAuthority").TrimEnd('/');
  if(!Uri.TryCreate(authority,UriKind.Absolute,out var uri)||uri.Scheme!="https"||!uri.Host.EndsWith(".ciamlogin.com",StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Configure a HTTPS Entra External ID authority.");
  tenant=Required("AuthTenantId");audience=Required("AuthAudience");scope=Required("AuthScope");
  manager=new(authority+"/.well-known/openid-configuration",new OpenIdConnectConfigurationRetriever());
 }
 public static string Required(string key)=>Environment.GetEnvironmentVariable(key) is {Length:>0} value?value:throw new InvalidOperationException($"Missing setting {key}.");
 public async Task<string> Owner(HttpRequestData req)
 {
  if(!req.Headers.TryGetValues("Authorization",out var headers))throw new UnauthorizedAccessException();
  var header=headers.SingleOrDefault();
  if(header is null||!header.StartsWith("Bearer ",StringComparison.OrdinalIgnoreCase))throw new UnauthorizedAccessException();
  try
  {
   var config=await manager.GetConfigurationAsync(CancellationToken.None);
   var handler=new JwtSecurityTokenHandler{MapInboundClaims=false};
   var result=await handler.ValidateTokenAsync(header[7..],new TokenValidationParameters{ValidateIssuer=true,ValidIssuer=config.Issuer,ValidateAudience=true,ValidAudience=audience,ValidateLifetime=true,RequireExpirationTime=true,RequireSignedTokens=true,ValidateIssuerSigningKey=true,IssuerSigningKeys=config.SigningKeys,ValidAlgorithms=[SecurityAlgorithms.RsaSha256],ClockSkew=TimeSpan.FromMinutes(1)});
   if(!result.IsValid){if(result.Exception is SecurityTokenSignatureKeyNotFoundException)manager.RequestRefresh();throw new UnauthorizedAccessException();}
   var claims=result.ClaimsIdentity;
   var oid=claims.FindFirst("oid")?.Value;
   // Deletion markers expire after 30 days; reject access tokens with lifetimes over 24 hours.
   if(!long.TryParse(claims.FindFirst("iat")?.Value,out var issued)||!long.TryParse(claims.FindFirst("exp")?.Value,out var expires)||expires<=issued||expires-issued>86400||issued>DateTimeOffset.UtcNow.ToUnixTimeSeconds()+60)throw new UnauthorizedAccessException();
   if(claims.FindFirst("tid")?.Value!=tenant || !Guid.TryParse(oid,out _) || !(claims.FindFirst("scp")?.Value.Split(' ')??[]).Contains(scope))throw new UnauthorizedAccessException();
   return tenant+":"+oid;
  }
  catch(SecurityTokenException){throw new UnauthorizedAccessException();}
 }
}
