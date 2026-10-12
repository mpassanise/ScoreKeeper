namespace Scorekeeper.Core;

public interface IAccountDeletionStore
{
 Task<string?> DeletionState(string owner);
 Task BeginDeletion(string owner);
 Task CompleteDeletion(string owner);
}
public interface ICustomerDirectory
{
 bool IsConfigured { get; }
 string TenantId { get; }
 Task VerifyCustomer(Guid customerId);
 Task DeleteCustomer(Guid customerId);
}
public record DeletionResult(string Status,string Message,Exception? Failure=null);
public sealed class AccountDeletionService(IAccountDeletionStore store,ICustomerDirectory directory)
{
 public async Task<DeletionResult> Delete(string owner,string confirmation)
 {
  if(confirmation!="DELETE")throw new ArgumentException("Type DELETE to confirm account deletion.");
  var parts=owner.Split(':');
  if(parts.Length!=2||!Guid.TryParse(parts[0],out var tenant)||!Guid.TryParse(parts[1],out var customer)||tenant!=Guid.Parse(directory.TenantId))throw new UnauthorizedAccessException();
  if(!directory.IsConfigured)throw new InvalidOperationException("Account deletion is not configured yet.");
  var state=await store.DeletionState(owner);
  if(state=="completed")return new("completed","Your account and saved games have been deleted.");
  if(state is null){await directory.VerifyCustomer(customer);await store.BeginDeletion(owner);}
  try
  {
   await directory.DeleteCustomer(customer);
   await store.CompleteDeletion(owner);
   return new("completed","Your account and saved games have been deleted.");
  }
  catch(Exception e)when(e is not OperationCanceledException)
  {
   return new("pending","Your deletion request is recorded, but has not finished. Your account is blocked from scoring. Use Retry deletion in Account to try again. Any unfinished request remains available to the operator for completion.",e);
  }
 }
}
