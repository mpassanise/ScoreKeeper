using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
using Scorekeeper.Api;
using Scorekeeper.Core;
var host=new HostBuilder().ConfigureFunctionsWorkerDefaults().ConfigureLogging(logging=>logging.AddFilter("Scorekeeper.Api",LogLevel.Information)).ConfigureServices(s=>{s.AddSingleton<TokenVerifier>();s.AddSingleton<GameStore>();s.AddSingleton<IGameOperationStore>(p=>p.GetRequiredService<GameStore>());s.AddSingleton<GameOperationService>();s.AddSingleton<IAccountDeletionStore>(p=>p.GetRequiredService<GameStore>());s.AddSingleton<ICustomerDirectory,CustomerDirectory>();s.AddSingleton<AccountDeletionService>();}).Build();
await host.RunAsync();
