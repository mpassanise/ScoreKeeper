-- Run as database administrator before deploying the frequent-player API.
IF OBJECT_ID('dbo.FrequentPlayers','U') IS NULL
BEGIN
 CREATE TABLE dbo.FrequentPlayers(OwnerId nvarchar(100) NOT NULL PRIMARY KEY,State nvarchar(max) NOT NULL,Updated datetimeoffset NOT NULL,CONSTRAINT CK_FrequentPlayers_Json CHECK(ISJSON(State)=1));
END;
IF OBJECT_ID('dbo.FrequentPlayerOperations','U') IS NULL
BEGIN
 CREATE TABLE dbo.FrequentPlayerOperations(OwnerId nvarchar(100) NOT NULL,OperationId uniqueidentifier NOT NULL,AppliedAt datetimeoffset NOT NULL,CONSTRAINT PK_FrequentPlayerOperations PRIMARY KEY(OwnerId,OperationId));
END;
GRANT SELECT,INSERT,UPDATE,DELETE ON OBJECT::dbo.FrequentPlayers TO [scorekeeper-api];
GRANT SELECT,INSERT,UPDATE,DELETE ON OBJECT::dbo.FrequentPlayerOperations TO [scorekeeper-api];
