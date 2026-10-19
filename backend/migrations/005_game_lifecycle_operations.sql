-- Keep ScorekeeperGameOperationsEnabled=false throughout deployment.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock=sys.sp_getapplock @Resource='scorekeeper:operations-schema',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
IF @lock<0 THROW 51000,'Operation schema is busy.',1;
IF OBJECT_ID('dbo.GameOperationSchema','U') IS NULL OR OBJECT_ID('dbo.GameOperationReceipts','U') IS NULL
 THROW 51000,'Apply migration 004 first.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.GameOperationSchema WHERE Version IN (1,2)) OR EXISTS(SELECT 1 FROM dbo.GameOperationSchema WHERE Version NOT IN (1,2))
 THROW 51000,'Unsupported operation schema.',1;
IF OBJECT_ID('dbo.GameEntryReservations','U') IS NULL
 CREATE TABLE dbo.GameEntryReservations(
  OwnerKey char(64) NOT NULL,GameId uniqueidentifier NOT NULL,EntryId uniqueidentifier NOT NULL,
  CONSTRAINT PK_GameEntryReservations PRIMARY KEY(OwnerKey,GameId,EntryId)
 );
IF ISNULL(COL_LENGTH('dbo.GameEntryReservations','OwnerKey'),0)<>64
 OR ISNULL(COL_LENGTH('dbo.GameEntryReservations','GameId'),0)<>16
 OR ISNULL(COL_LENGTH('dbo.GameEntryReservations','EntryId'),0)<>16
 OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.GameEntryReservations') AND name='PK_GameEntryReservations' AND is_primary_key=1 AND is_disabled=0)
 THROW 51000,'Entry reservation schema is incompatible.',1;
-- Retain only identifiers, including already-undone receipt-backed scores.
INSERT dbo.GameEntryReservations(OwnerKey,GameId,EntryId)
 SELECT ids.OwnerKey,ids.GameId,ids.EntryId FROM(
  SELECT CONVERT(char(64),HASHBYTES('SHA2_256',CONVERT(varchar(max),OwnerId COLLATE Latin1_General_100_BIN2_UTF8)),2) OwnerKey,GameId,entries.EntryId
   FROM dbo.Games CROSS APPLY OPENJSON(State,'$.entries') WITH(EntryId uniqueidentifier '$.id') entries
  UNION
  SELECT OwnerKey,GameId,AddedEntryId FROM dbo.GameOperationReceipts WHERE AddedEntryId IS NOT NULL
 ) ids WHERE ids.EntryId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dbo.GameEntryReservations r WHERE r.OwnerKey=ids.OwnerKey AND r.GameId=ids.GameId AND r.EntryId=ids.EntryId);
DELETE dbo.GameOperationSchema WHERE Version=1;
IF NOT EXISTS(SELECT 1 FROM dbo.GameOperationSchema WHERE Version=2) INSERT dbo.GameOperationSchema(Version) VALUES(2);
GRANT SELECT,INSERT,DELETE ON dbo.GameEntryReservations TO [scorekeeper-api];
COMMIT;
