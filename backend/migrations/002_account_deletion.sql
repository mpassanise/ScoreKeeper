-- Apply in free-sql-db-4371450 BEFORE deploying the new API. Does not delete existing games.
IF OBJECT_ID('dbo.AccountDeletions','U') IS NULL
BEGIN
 CREATE TABLE dbo.AccountDeletions(
  OwnerKey char(64) NOT NULL PRIMARY KEY,
  OwnerId nvarchar(100) NULL,
  Status varchar(12) NOT NULL CHECK(Status IN ('pending','completed')),
  RequestedAt datetimeoffset NOT NULL,
  CompletedAt datetimeoffset NULL
 );
 CREATE INDEX IX_AccountDeletions_CompletedAt ON dbo.AccountDeletions(CompletedAt);
END;
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.AccountDeletions TO [scorekeeper-api];
GRANT DELETE ON OBJECT::dbo.Games TO [scorekeeper-api];
