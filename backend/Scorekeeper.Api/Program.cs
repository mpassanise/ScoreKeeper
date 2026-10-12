using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Scorekeeper.Api;
var host=new HostBuilder().ConfigureFunctionsWorkerDefaults().ConfigureServices(s=>{s.AddSingleton<TokenVerifier>();s.AddSingleton<GameStore>();}).Build();
await host.RunAsync();
