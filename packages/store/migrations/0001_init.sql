-- The online copy of shared drawings. Everything stored here was sealed in a browser with
-- the drawing's secret, which never reaches the server: the store holds bytes it cannot read.

-- One row per drawing something has been written to: who may write it, and what it holds.
CREATE TABLE drawings (
  id TEXT PRIMARY KEY,
  -- The scene's revision, which a scene write's If-Match names. 0 until a scene is written:
  -- a picture can be stored first.
  rev INTEGER NOT NULL,
  -- Hex SHA-256 of the write token, set by the first write and never changed.
  proof TEXT NOT NULL,
  -- New on every write. A write lands only if the nonce is still the one it was decided on.
  nonce TEXT NOT NULL,
  -- Milliseconds since the epoch. Writes sweep away drawings a year old.
  written_at INTEGER NOT NULL,
  -- The scene and the pictures together: what the size cap counts.
  bytes INTEGER NOT NULL,
  scene_bytes INTEGER NOT NULL,
  pictures INTEGER NOT NULL
);

-- The sweep's lookup. Without it every write would read every drawing.
CREATE INDEX drawings_written_at ON drawings (written_at);

-- The bytes, in parts each under D1's row limit. item '' is the scene, any other item is a
-- picture's id. WITHOUT ROWID: the key is the table, so a part costs one row written
-- rather than two (D1 counts an index row as a row written).
CREATE TABLE parts (
  drawing_id TEXT NOT NULL,
  item TEXT NOT NULL,
  n INTEGER NOT NULL,
  -- Base64. src/d1.ts says why not a BLOB.
  data TEXT NOT NULL,
  PRIMARY KEY (drawing_id, item, n)
) WITHOUT ROWID;
