CREATE TABLE IF NOT EXISTS visits (
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  lat REAL,
  lon REAL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (city, country)
);
