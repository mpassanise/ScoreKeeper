-- Additive migration: no game or receipt bytes change. Existing apps stay unclaimed.
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @lock int;
EXEC @lock=sys.sp_getapplock @Resource='scorekeeper:operations-schema',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
IF @lock<0 THROW 51000,'Operation schema is busy.',1;
IF OBJECT_ID('dbo.GameScoringControl','U') IS NULL
 CREATE TABLE dbo.GameScoringControl(
  OwnerKey char(64) NOT NULL,GameId uniqueidentifier NOT NULL,DeviceId uniqueidentifier NOT NULL,
  Epoch bigint NOT NULL CHECK(Epoch BETWEEN 1 AND 9007199254740991),
  CONSTRAINT PK_GameScoringControl PRIMARY KEY(OwnerKey,GameId)
 );
IF ISNULL(COL_LENGTH('dbo.GameScoringControl','OwnerKey'),0)<>64
 OR ISNULL(COL_LENGTH('dbo.GameScoringControl','GameId'),0)<>16
 OR ISNULL(COL_LENGTH('dbo.GameScoringControl','DeviceId'),0)<>16
 OR ISNULL(COL_LENGTH('dbo.GameScoringControl','Epoch'),0)<>8
 OR NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.GameScoringControl') AND is_primary_key=1 AND is_disabled=0)
 THROW 51000,'Scoring control schema is incompatible.',1;
IF DATABASE_PRINCIPAL_ID('scorekeeper-api') IS NOT NULL
 GRANT SELECT,INSERT,UPDATE,DELETE ON dbo.GameScoringControl TO [scorekeeper-api];
COMMIT TRANSACTION;
