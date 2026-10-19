-- Run as a database administrator. Additive; keeps all existing game/player data.
-- Requires schema.sql and migrations 002/003. Keep ScorekeeperGameOperationsEnabled=false.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @lockResult int;
EXEC @lockResult=sys.sp_getapplock @Resource='scorekeeper:operations-schema',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
IF @lockResult<0 THROW 51000,'Operation schema is busy. Retry migration.',1;
IF OBJECT_ID('dbo.Games','U') IS NULL OR OBJECT_ID('dbo.AccountDeletions','U') IS NULL
 THROW 51001,'Install the base game and account deletion schemas first.',1;
IF OBJECT_ID('dbo.GameOperationSchema','U') IS NULL
 CREATE TABLE dbo.GameOperationSchema(Version int NOT NULL CONSTRAINT PK_GameOperationSchema PRIMARY KEY,InstalledAt datetimeoffset NOT NULL CONSTRAINT DF_GameOperationSchema_Installed DEFAULT SYSDATETIMEOFFSET());
IF EXISTS(SELECT 1 FROM dbo.GameOperationSchema WHERE Version<>1)
 THROW 51002,'Unknown operation schema version. Existing data was preserved.',1;
IF OBJECT_ID('dbo.GameOperationReceipts','U') IS NULL
BEGIN
 CREATE TABLE dbo.GameOperationReceipts(
  OwnerKey char(64) NOT NULL,
  OperationId uniqueidentifier NOT NULL,
  GameId uniqueidentifier NOT NULL,
  Fingerprint char(64) NOT NULL,
  Acknowledgement nvarchar(2000) NOT NULL,
  AddedEntryId uniqueidentifier NULL,
  CreatedAt datetimeoffset NOT NULL CONSTRAINT DF_GameOperationReceipts_Created DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT PK_GameOperationReceipts PRIMARY KEY(OwnerKey,OperationId),
  CONSTRAINT CK_GameOperationReceipts_Json CHECK(ISJSON(Acknowledgement)=1)
 );
 CREATE UNIQUE INDEX UX_GameOperationReceipts_Entry ON dbo.GameOperationReceipts(OwnerKey,GameId,AddedEntryId) WHERE AddedEntryId IS NOT NULL;
END;
-- Fail closed on a partial/incompatible prior installation. Never drop or rebuild data.
IF ISNULL(COL_LENGTH('dbo.GameOperationReceipts','OwnerKey'),0)<>64
 OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','OperationId'),0)<>16
 OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','GameId'),0)<>16
 OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','Fingerprint'),0)<>64
 OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','Acknowledgement'),0)<>4000
 OR ISNULL(COL_LENGTH('dbo.GameOperationReceipts','AddedEntryId'),0)<>16
 OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.GameOperationReceipts') AND name='PK_GameOperationReceipts' AND is_primary_key=1 AND is_disabled=0)
 OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.GameOperationReceipts') AND name='UX_GameOperationReceipts_Entry' AND is_unique=1 AND has_filter=1 AND is_disabled=0)
 THROW 51003,'Incompatible receipt schema. Existing data was preserved.',1;
IF NOT EXISTS(SELECT 1 FROM dbo.GameOperationSchema WHERE Version=1) INSERT dbo.GameOperationSchema(Version) VALUES(1);
-- Substitute the deployed managed-identity database user if different.
GRANT SELECT,INSERT,DELETE ON OBJECT::dbo.GameOperationReceipts TO [scorekeeper-api];
GRANT SELECT ON OBJECT::dbo.GameOperationSchema TO [scorekeeper-api];
COMMIT TRANSACTION;
-- No receipt expiry job: retain receipts and entry reservations until explicit account deletion.
-- Deploy the API that retains completed account-deletion markers before enabling this protocol.
