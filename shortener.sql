CREATE TABLE IF NOT EXISTS "links" (
	"user"	TEXT NOT NULL,
	"created"	INTEGER NOT NULL,
	"url"	TEXT NOT NULL,
	"slug"	TEXT NOT NULL,
	"title"	TEXT,
	"count_clicks"	INTEGER NOT NULL DEFAULT 0
, "disabled"	INTEGER NOT NULL DEFAULT 0);
