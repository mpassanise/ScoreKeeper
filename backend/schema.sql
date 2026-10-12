-- Apply once with an administrator identity. App identity needs SELECT, INSERT and UPDATE only.
IF OBJECT_ID('dbo.Games','U') IS NULL
BEGIN
CREATE TABLE dbo.Games (
 OwnerId nvarchar(100) NOT NULL,
 GameId uniqueidentifier NOT NULL,
 Version bigint NOT NULL,
 Updated datetimeoffset NOT NULL,
 State nvarchar(max) NOT NULL,
 CONSTRAINT PK_Games PRIMARY KEY (OwnerId,GameId),
 CONSTRAINT CK_Games_Json CHECK (ISJSON(State)=1)
);
CREATE INDEX IX_Games_OwnerUpdated ON dbo.Games(OwnerId,Updated DESC);
END;
-- In Azure SQL, substitute the actual Function App managed-identity name below:
-- CREATE USER [scorekeeper-api] FROM EXTERNAL PROVIDER;
-- GRANT SELECT, INSERT, UPDATE ON dbo.Games TO [scorekeeper-api];

-- For account deletion, also run migrations/002_account_deletion.sql before the updated API.
