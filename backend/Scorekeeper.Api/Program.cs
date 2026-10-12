using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Scorekeeper.Api;
using Scorekeeper.Core;
var host=new HostBuilder().ConfigureFunctionsWorkerDefaults().ConfigureServices(s=>{s.AddSingleton<TokenVerifier>();s.AddSingleton<GameStore>();s.AddSingleton<IAccountDeletionStore>(p=>p.GetRequiredService<GameStore>());s.AddSingleton<ICustomerDirectory,CustomerDirectory>();s.AddSingleton<AccountDeletionService>();}).Build();
await host.RunAsync();
